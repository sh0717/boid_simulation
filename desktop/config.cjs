module.exports = {
  appId: 'local.murmuration.boids',
  productName: 'Murmuration Boids Lab',
  artifactStem: 'Murmuration-Boids-Lab',
  scheme: 'boids',
  entry: 'index.html',
  icon: 'icon.ico',
  backgroundColor: '#091516',
  csp: "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  assets: [
    ['dist/index.html', 'index.html'],
    ['dist/styles.css', 'styles.css'],
    ['dist/app.js', 'app.js'],
    ['dist/THREE-LICENSE.txt', 'dist/THREE-LICENSE.txt'],
    ['dist/CORE-LICENSES.txt', 'dist/CORE-LICENSES.txt'],
  ],
};
