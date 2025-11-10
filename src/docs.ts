import { readFile, readdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { marked } from "marked";
import { logger } from "./logger.js";

export interface DocMetadata {
  name: string;
  displayName: string;
  path: string;
}

// Available documentation files mapping
const DOCS_MAP: Record<string, string> = {
  "README": "README.md",
  "AGENTS": "AGENTS.md",
  "NVIDIA_GPU_ACCELERATION": "docs/NVIDIA_GPU_ACCELERATION.md",
};

/**
 * Get list of available documentation
 */
export function listDocs(): DocMetadata[] {
  return Object.entries(DOCS_MAP).map(([name, path]) => ({
    name,
    displayName: name.split("_").map(word =>
      word.charAt(0) + word.slice(1).toLowerCase()
    ).join(" "),
    path,
  }));
}

/**
 * Read and render markdown file to HTML
 */
export async function renderMarkdown(docName: string): Promise<string | null> {
  const docPath = DOCS_MAP[docName];

  if (!docPath) {
    logger.warn("docs", "Documentation not found", { docName });
    return null;
  }

  try {
    const fullPath = join(process.cwd(), docPath);
    const markdown = await readFile(fullPath, "utf-8");
    const html = await marked.parse(markdown);
    return html;
  } catch (error) {
    logger.error("docs", "Error reading markdown file", { docPath, error });
    return null;
  }
}

/**
 * Generate HTML page for documentation
 */
export function generateDocsPage(title: string, content: string, docName?: string): string {
  const docsList = listDocs();
  const currentDoc = docName || null;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Documentation</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      background-color: #f5f5f5;
    }

    .container {
      display: flex;
      min-height: 100vh;
    }

    .sidebar {
      width: 250px;
      background-color: #2c3e50;
      color: #ecf0f1;
      padding: 2rem 0;
      position: fixed;
      height: 100vh;
      overflow-y: auto;
    }

    .sidebar h2 {
      padding: 0 1.5rem 1rem;
      font-size: 1.5rem;
      border-bottom: 1px solid #34495e;
      margin-bottom: 1rem;
    }

    .sidebar nav ul {
      list-style: none;
    }

    .sidebar nav a {
      display: block;
      padding: 0.75rem 1.5rem;
      color: #ecf0f1;
      text-decoration: none;
      transition: background-color 0.2s;
    }

    .sidebar nav a:hover {
      background-color: #34495e;
    }

    .sidebar nav a.active {
      background-color: #3498db;
      font-weight: bold;
    }

    .main-content {
      flex: 1;
      margin-left: 250px;
      padding: 2rem;
    }

    .content-wrapper {
      max-width: 900px;
      margin: 0 auto;
      background-color: white;
      padding: 3rem;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
    }

    .content h1 {
      color: #2c3e50;
      margin-bottom: 1.5rem;
      padding-bottom: 0.5rem;
      border-bottom: 3px solid #3498db;
    }

    .content h2 {
      color: #34495e;
      margin-top: 2rem;
      margin-bottom: 1rem;
    }

    .content h3 {
      color: #546e7a;
      margin-top: 1.5rem;
      margin-bottom: 0.75rem;
    }

    .content p {
      margin-bottom: 1rem;
    }

    .content ul, .content ol {
      margin-bottom: 1rem;
      padding-left: 2rem;
    }

    .content li {
      margin-bottom: 0.5rem;
    }

    .content pre {
      background-color: #f8f9fa;
      border: 1px solid #e9ecef;
      border-radius: 4px;
      padding: 1rem;
      overflow-x: auto;
      margin-bottom: 1rem;
    }

    .content code {
      background-color: #f8f9fa;
      padding: 0.2rem 0.4rem;
      border-radius: 3px;
      font-family: 'Courier New', Courier, monospace;
      font-size: 0.9em;
    }

    .content pre code {
      background-color: transparent;
      padding: 0;
    }

    .content blockquote {
      border-left: 4px solid #3498db;
      padding-left: 1rem;
      margin: 1rem 0;
      color: #546e7a;
      font-style: italic;
    }

    .content table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 1rem;
    }

    .content th, .content td {
      border: 1px solid #ddd;
      padding: 0.75rem;
      text-align: left;
    }

    .content th {
      background-color: #f8f9fa;
      font-weight: bold;
    }

    .content a {
      color: #3498db;
      text-decoration: none;
    }

    .content a:hover {
      text-decoration: underline;
    }

    .doc-index {
      list-style: none;
      padding: 0;
    }

    .doc-index li {
      margin-bottom: 1.5rem;
    }

    .doc-index h3 {
      margin: 0 0 0.5rem 0;
    }

    .doc-index a {
      font-size: 1.2rem;
      color: #2c3e50;
      text-decoration: none;
      font-weight: bold;
    }

    .doc-index a:hover {
      color: #3498db;
    }

    .doc-index p {
      color: #666;
      margin: 0;
    }

    @media (max-width: 768px) {
      .sidebar {
        width: 200px;
      }

      .main-content {
        margin-left: 200px;
      }

      .content-wrapper {
        padding: 1.5rem;
      }
    }

    @media (max-width: 480px) {
      .sidebar {
        position: static;
        width: 100%;
        height: auto;
      }

      .main-content {
        margin-left: 0;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <aside class="sidebar">
      <h2>📚 Documentation</h2>
      <nav>
        <ul>
          <li><a href="/docs" class="${!currentDoc ? 'active' : ''}">Home</a></li>
          ${docsList.map(doc => `
          <li><a href="/docs/${doc.name}" class="${currentDoc === doc.name ? 'active' : ''}">${doc.displayName}</a></li>
          `).join('')}
        </ul>
      </nav>
    </aside>
    <main class="main-content">
      <div class="content-wrapper">
        <div class="content">
          ${content}
        </div>
      </div>
    </main>
  </div>
</body>
</html>`;
}

/**
 * Generate index page listing all documentation
 */
export function generateIndexPage(): string {
  const docsList = listDocs();

  const content = `
    <h1>Documentation</h1>
    <p>Welcome to the documentation. Select a topic from the sidebar or browse below:</p>
    <ul class="doc-index">
      ${docsList.map(doc => `
        <li>
          <h3><a href="/docs/${doc.name}">${doc.displayName}</a></h3>
          <p>View ${doc.displayName.toLowerCase()} documentation</p>
        </li>
      `).join('')}
    </ul>
  `;

  return generateDocsPage("Home", content);
}
