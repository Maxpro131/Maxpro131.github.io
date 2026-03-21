const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 5000;

app.use(express.static(__dirname));

app.get('/proxy-pack', async (req, res) => {
  try {
    const configPath = path.join(__dirname, 'config', 'variables-config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const packUrl = config.packDownloadUrl;

    if (!packUrl) {
      return res.status(404).json({ error: 'No packDownloadUrl configured.' });
    }

    const upstream = await fetch(packUrl);
    if (!upstream.ok) {
      return res.status(502).json({ error: `Upstream fetch failed: ${upstream.status}` });
    }

    const buffer = await upstream.arrayBuffer();
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="pack.mcpack"');
    res.send(Buffer.from(buffer));
  } catch (e) {
    console.error('Proxy error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
