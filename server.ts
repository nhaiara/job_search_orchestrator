import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import puppeteer from 'puppeteer';
import MarkdownIt from 'markdown-it';
import { Readable } from 'stream';

dotenv.config();

const md = new MarkdownIt();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  // Google Drive Setup
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    `${process.env.APP_URL || 'http://localhost:3000'}/auth/google/callback`
  );

  const getDriveInstance = (accessToken?: string) => {
    if (!accessToken) {
      throw new Error('Google Drive access token is required. Please connect your Drive.');
    }
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    return google.drive({ version: 'v3', auth });
  };

  // OAuth Routes
  app.get('/api/auth/google/url', (req, res) => {
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/drive'],
      prompt: 'consent'
    });
    res.json({ url });
  });

  app.get(['/auth/google/callback', '/auth/google/callback/'], async (req, res) => {
    const { code } = req.query;
    try {
      const { tokens } = await oauth2Client.getToken(code as string);
      res.send(`
        <html>
          <body>
            <script>
              window.opener.postMessage({ type: 'GOOGLE_AUTH_SUCCESS', tokens: ${JSON.stringify(tokens)} }, '*');
              window.close();
            </script>
            <p>Autenticação concluída! Esta janela fechará automaticamente.</p>
          </body>
        </html>
      `);
    } catch (error: any) {
      console.error('Error exchanging code:', error);
      res.status(500).send('Erro na autenticação do Google.');
    }
  });

  // API Routes
  const getOrCreateFolder = async (driveClient: any, parentId: string, folderName: string) => {
    const response = await driveClient.files.list({
      q: `name = '${folderName}' and '${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id)',
    });
    
    if (response.data.files && response.data.files.length > 0) {
      return response.data.files[0].id;
    }
    
    const folder = await driveClient.files.create({
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId]
      },
      fields: 'id'
    });
    
    return folder.data.id;
  };

  const moveFile = async (driveClient: any, fileId: string, currentParents: string[], targetId: string) => {
    const previousParents = currentParents.join(',');
    await driveClient.files.update({
      fileId: fileId,
      addParents: targetId,
      removeParents: previousParents,
      fields: 'id, parents'
    });
  };

  app.post('/api/sync-drive', async (req, res) => {
    try {
      const { folderId, accessToken, processedFolderId } = req.body;
      if (!folderId) return res.status(400).json({ error: 'Folder ID is required' });

      const driveClient = getDriveInstance(accessToken);
      const response = await driveClient.files.list({
        q: `'${folderId}' in parents and (name contains '.md' or mimeType = 'application/vnd.google-apps.document') and trashed = false`,
        fields: 'files(id, name, createdTime, mimeType, parents)',
      });

      const files = response.data.files || [];
      const results = [];

      // Determine target folder for moving
      let targetFolderId = processedFolderId;

      for (const file of files) {
        let content;
        try {
          if (file.mimeType === 'application/vnd.google-apps.document') {
            const exportResponse = await driveClient.files.export({
              fileId: file.id!,
              mimeType: 'text/plain',
            });
            content = exportResponse.data;
          } else {
            const contentResponse = await driveClient.files.get({
              fileId: file.id!,
              alt: 'media',
            });
            content = contentResponse.data;
          }

          results.push({
            id: file.id,
            name: file.name,
            content: content,
            createdAt: file.createdTime
          });

          // Move file to processed folder
          if (file.id) {
            try {
              if (targetFolderId) {
                await moveFile(driveClient, file.id, file.parents || [], targetFolderId);
              } else {
                throw new Error('No processed folder ID provided');
              }
            } catch (moveError) {
              console.warn(`Failed to move to ${targetFolderId}, trying "sincronizadas":`, moveError);
              try {
                const fallbackId = await getOrCreateFolder(driveClient, folderId, 'sincronizadas');
                targetFolderId = fallbackId; // Update for subsequent files
                await moveFile(driveClient, file.id, file.parents || [], fallbackId);
              } catch (fallbackError) {
                console.error('Failed to move to fallback folder:', fallbackError);
              }
            }
          }
        } catch (fileError) {
          console.error(`Error processing file ${file.name}:`, fileError);
          // Continue with next file
        }
      }

      res.json({ files: results, processedFolderId: targetFolderId });
    } catch (error: any) {
      console.error('Error syncing drive:', error);
      const errorMessage = error.response?.data?.error?.message || error.message || 'Failed to sync Google Drive';
      res.status(500).json({ 
        error: errorMessage
      });
    }
  });

  app.post('/api/cleanup-drive', async (req, res) => {
    try {
      const { accessToken } = req.body;
      const driveClient = getDriveInstance(accessToken);
      await driveClient.files.emptyTrash();
      res.json({ message: 'Trash emptied successfully' });
    } catch (error: any) {
      console.error('Error emptying trash:', error);
      const errorMessage = error.response?.data?.error?.message || error.message || 'Failed to empty trash';
      res.status(500).json({ error: errorMessage });
    }
  });

  app.post('/api/generate-application', async (req, res) => {
    try {
      const { name, company, role, cvContent, clContent, outputFolderId, processedFolderId, originalFileId, accessToken } = req.body;
      
      if (!outputFolderId) return res.status(400).json({ error: 'Output Folder ID is required' });

      const driveClient = getDriveInstance(accessToken);

      // 1. Create Folder: "Data - Empresa - Cargo"
      const date = new Date().toISOString().split('T')[0];
      const folderName = `${date} - ${company} - ${role}`;
      
      const folderResponse = await driveClient.files.create({
        requestBody: {
          name: folderName,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [outputFolderId]
        },
        fields: 'id, webViewLink'
      });
      
      const folderId = folderResponse.data.id!;
      const folderLink = folderResponse.data.webViewLink!;

      // Helper to create PDF via Google Docs Export
      const createPdf = async (fileName: string, markdown: string) => {
        const html = md.render(markdown);
        
        // 1. Create a temporary Google Doc from HTML
        const tempDocResponse = await driveClient.files.create({
          requestBody: {
            name: `TEMP_${fileName}`,
            mimeType: 'application/vnd.google-apps.document',
            parents: [folderId] // Put it in the same folder temporarily
          },
          media: {
            mimeType: 'text/html',
            body: `
              <html>
                <head>
                  <style>
                    body { font-family: 'Arial', sans-serif; line-height: 1.5; font-size: 11pt; }
                    h1 { font-size: 24pt; margin-bottom: 10px; }
                    h2 { font-size: 18pt; margin-top: 20px; margin-bottom: 10px; }
                    p { margin-bottom: 10px; }
                  </style>
                </head>
                <body>${html}</body>
              </html>
            `
          }
        });

        const tempDocId = tempDocResponse.data.id!;

        try {
          // 2. Export the Google Doc as PDF
          const exportResponse = await driveClient.files.export({
            fileId: tempDocId,
            mimeType: 'application/pdf'
          }, { responseType: 'arraybuffer' });

          const pdfBuffer = Buffer.from(exportResponse.data as ArrayBuffer);

          // 3. Upload the PDF to the target folder
          await driveClient.files.create({
            requestBody: {
              name: fileName,
              parents: [folderId],
              mimeType: 'application/pdf'
            },
            media: {
              mimeType: 'application/pdf',
              body: Readable.from(pdfBuffer)
            }
          });
        } catch (error) {
          console.error('Error in createPdf:', error);
          throw error;
        }
        // Removed the finally block that deleted tempDocId to keep the Google Doc
      };

      // 2. Generate CV and CL PDFs
      await createPdf(`CV - ${name}.pdf`, cvContent);
      await createPdf(`Cover Letter - ${name}.pdf`, clContent);

      // 3. Move original file to processed if originalFileId exists
      if (originalFileId) {
        try {
          const file = await driveClient.files.get({
            fileId: originalFileId,
            fields: 'parents'
          });
          const currentParents = file.data.parents || [];
          
          try {
            if (processedFolderId) {
              await moveFile(driveClient, originalFileId, currentParents, processedFolderId);
            } else {
              throw new Error('No processed folder ID');
            }
          } catch (moveError) {
            console.warn('Failed to move to processedFolderId, trying fallback:', moveError);
            const parentId = currentParents[0];
            if (parentId) {
              const fallbackId = await getOrCreateFolder(driveClient, parentId, 'sincronizadas');
              await moveFile(driveClient, originalFileId, currentParents, fallbackId);
            }
          }
        } catch (error) {
          console.warn('Failed to move original file:', error);
        }
      }

      res.json({ folderId, folderLink });
    } catch (error: any) {
      console.error('Error generating application:', error);
      let errorMessage = error.response?.data?.error?.message || error.message || 'Failed to generate application files';
      
      if (errorMessage.includes('storage quota') || errorMessage.includes('quota exceeded')) {
        errorMessage = 'Cota de armazenamento do Google Drive excedida. Por favor, limpe espaço no seu Drive.';
      }

      res.status(500).json({ 
        error: errorMessage
      });
    }
  });

  app.post('/api/get-drive-file', async (req, res) => {
    try {
      const { fileId, accessToken } = req.body;
      if (!fileId) return res.status(400).json({ error: 'File ID is required' });

      const driveClient = getDriveInstance(accessToken);

      // First, get file metadata to check mimeType
      const fileMetadata = await driveClient.files.get({
        fileId: fileId,
        fields: 'mimeType',
      });

      const mimeType = fileMetadata.data.mimeType;
      let content;

      if (mimeType === 'application/vnd.google-apps.document') {
        // It's a Google Doc, we must export it
        const exportResponse = await driveClient.files.export({
          fileId: fileId,
          mimeType: 'text/plain',
        });
        content = exportResponse.data;
      } else {
        // It's a binary file (like .md), we can download it
        const contentResponse = await driveClient.files.get({
          fileId: fileId,
          alt: 'media',
        });
        content = contentResponse.data;
      }

      res.json({ content });
    } catch (error: any) {
      console.error('Error fetching drive file:', error);
      const errorMessage = error.response?.data?.error?.message || error.message || 'Failed to fetch file from Google Drive';
      res.status(500).json({ 
        error: errorMessage
      });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    console.log('Starting Vite in middleware mode...');
    const vite = await createViteServer({
      root: process.cwd(),
      server: { 
        middlewareMode: true,
        watch: {
          usePolling: true,
          interval: 100
        }
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    console.log('Vite middleware integrated.');
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
