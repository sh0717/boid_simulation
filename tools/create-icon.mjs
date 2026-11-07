// Optional asset regeneration; the checked-in .ico is sufficient for EXE builds.
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 256, height: 256 },
    deviceScaleFactor: 1,
  });
  await page.goto(pathToFileURL(path.join(root, 'desktop/icon.svg')).href);
  const png = await page.screenshot({ omitBackground: true });
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2); // ICO
  header.writeUInt16LE(1, 4); // one 256 x 256 PNG entry (0 encodes 256)
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  await writeFile(path.join(root, 'desktop/icon.ico'), Buffer.concat([header, png]));
} finally {
  await browser.close();
}
