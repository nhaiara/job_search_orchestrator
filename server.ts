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

  const getDriveInstance = (accessToken?: string, refreshToken?: string) => {
    if (!accessToken) {
      throw new Error('Google Drive access token is required. Please connect your Drive.');
    }
    const auth = new google.auth.OAuth2(clientId, clientSecret);
    auth.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
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

  app.post('/api/scrape-job', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    let browser;
    try {
      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      const page = await browser.newPage();
      
      // Set a realistic user agent
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

      // Extract text content and basic metadata
      const data = await page.evaluate(() => {
        // Remove script and style elements
        const scripts = document.querySelectorAll('script, style, nav, footer, header, noscript');
        scripts.forEach(s => s.remove());

        // Try to find the job description container (common patterns)
        const selectors = [
          '[class*="job-description"]',
          '[class*="jobDescription"]',
          '[id*="job-description"]',
          '[class*="description"]',
          'main',
          'article',
          '.job-info',
          '#content'
        ];

        let content = '';
        for (const selector of selectors) {
          const el = document.querySelector(selector) as HTMLElement;
          if (el && el.innerText && el.innerText.length > 500) {
            content = el.innerText;
            break;
          }
        }

        if (!content) {
          content = document.body.innerText;
        }

        return {
          title: document.title,
          content: content.trim()
        };
      });

      res.json(data);
    } catch (error: any) {
      console.error('Scraping error:', error);
      res.status(500).json({ error: `Failed to scrape URL: ${error.message}` });
    } finally {
      if (browser) await browser.close();
    }
  });

  app.post('/api/sync-drive', async (req, res) => {
    try {
      const { folderId, accessToken, refreshToken } = req.body;
      if (!folderId) return res.status(400).json({ error: 'Folder ID is required' });

      const driveClient = getDriveInstance(accessToken, refreshToken);
      const response = await driveClient.files.list({
        q: `'${folderId}' in parents and (name contains '.md' or mimeType = 'application/vnd.google-apps.document' or mimeType = 'text/plain') and trashed = false`,
        fields: 'files(id, name, createdTime, mimeType, parents)',
        pageSize: 1000,
      });

      const files = response.data.files || [];
      const results = [];

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
            createdAt: file.createdTime,
            parents: file.parents
          });
        } catch (fileError) {
          console.error(`Error processing file ${file.name}:`, fileError);
        }
      }

      res.json({ files: results });
    } catch (error: any) {
      console.error('Error syncing drive:', error);
      const statusCode = error.response?.status || 500;
      const errorMessage = error.response?.data?.error?.message || error.message || 'Failed to sync Google Drive';
      
      if (error.response?.data?.error) {
        console.error('Detailed Drive Error:', JSON.stringify(error.response.data.error));
      }
      
      res.status(statusCode).json({ error: errorMessage });
    }
  });

  app.post('/api/move-file', async (req, res) => {
    try {
      const { fileId, currentParents, targetFolderId, accessToken, refreshToken, rootFolderId } = req.body;
      if (!fileId || !accessToken) return res.status(400).json({ error: 'Missing required fields' });

      const driveClient = getDriveInstance(accessToken, refreshToken);
      
      let finalTargetId = targetFolderId;
      if (!finalTargetId && rootFolderId) {
        finalTargetId = await getOrCreateFolder(driveClient, rootFolderId, 'sincronizadas');
      }

      if (!finalTargetId) {
        return res.status(400).json({ error: 'Target folder ID is required' });
      }

      await moveFile(driveClient, fileId, currentParents || [], finalTargetId);
      res.json({ success: true, targetFolderId: finalTargetId });
    } catch (error: any) {
      console.error('Error moving file:', error);
      const statusCode = error.response?.status || 500;
      res.status(statusCode).json({ error: error.message });
    }
  });

  app.post('/api/cleanup-drive', async (req, res) => {
    try {
      const { accessToken, refreshToken } = req.body;
      const driveClient = getDriveInstance(accessToken, refreshToken);
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
      const { name, company, role, cvContent, clContent, outputFolderId, processedFolderId, originalFileId, accessToken, refreshToken } = req.body;
      
      if (!outputFolderId) return res.status(400).json({ error: 'Output Folder ID is required' });

      const driveClient = getDriveInstance(accessToken, refreshToken);

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
      const { fileId, accessToken, refreshToken } = req.body;
      if (!fileId) return res.status(400).json({ error: 'File ID is required' });

      const driveClient = getDriveInstance(accessToken, refreshToken);

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
