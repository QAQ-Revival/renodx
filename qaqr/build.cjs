const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const workspace = path.resolve(root, '../..');
function run(file, args, options = {}) {
  const result = spawnSync(file, args, { cwd: root, windowsHide: true, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options });
  if (result.error || result.status) throw Error(result.error?.message || [result.stdout, result.stderr].filter(Boolean).join('\n').slice(-12000) || `${path.basename(file)} failed (${result.status})`);
  return (result.stdout || '').trim();
}
function tool(name, candidates = []) {
  const result = spawnSync('where.exe', [name], { encoding: 'utf8', windowsHide: true });
  const found = [...candidates, ...(result.status === 0 ? result.stdout.trim().split(/\r?\n/) : [])].find(file => file && fs.existsSync(file));
  if (!found) throw Error('Required build tool is missing: ' + name);
  return found;
}
function build({ output = path.join(workspace, 'local-components/endfield-hdr'), work = path.join(workspace, 'build/endfield-hdr') } = {}) {
  const cache = path.join(workspace, '.cache/endfield-hdr');
  const cmakeCache = path.join(cache, 'cmake');
  const cmakeDirectory = fs.existsSync(cmakeCache) && fs.readdirSync(cmakeCache).find(name => name.startsWith('cmake-'));
  const cmake = tool('cmake.exe', [process.env.QAQR_CMAKE, cmakeDirectory && path.join(cmakeCache, cmakeDirectory, 'bin/cmake.exe')]);
  const ninja = tool('ninja.exe', [process.env.QAQR_NINJA, path.join(cache, 'ninja/ninja.exe')]);
  const python = tool('python.exe', [process.env.QAQR_PYTHON, path.join(workspace, '.cache/python312/python.exe')]);
  const vswhere = path.join(process.env['ProgramFiles(x86)'], 'Microsoft Visual Studio/Installer/vswhere.exe');
  const vs = run(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath']);
  const environment = run('cmd.exe', ['/d', '/s', '/c', `""${path.join(vs, 'VC/Auxiliary/Build/vcvars64.bat')}" >nul && set"`], { windowsVerbatimArguments: true });
  const env = { ...process.env };
  // Only the tool setup talks to the GitHub API; the compilers and everything they run do without the job's token.
  const token = env.GITHUB_TOKEN;
  delete env.GITHUB_TOKEN;
  for (const line of environment.split(/\r?\n/)) {
    const equal = line.indexOf('=');
    if (equal < 1) continue;
    const name = line.slice(0, equal);
    for (const key of Object.keys(env)) if (key.toLowerCase() === name.toLowerCase()) delete env[key];
    env[name] = line.slice(equal + 1);
  }
  // The upstream setup script unpacks with an overload only PowerShell 7 has; Windows PowerShell stands in where that is all there is.
  const setupShell = spawnSync('where.exe', ['pwsh.exe'], { windowsHide: true }).status === 0 ? 'pwsh.exe' : 'powershell.exe';
  const shaderTools = path.join(cache, 'shader-tools');
  // Through qaqr/setup-tools.ps1, which lets the script's GitHub API requests carry the CI job's token.
  const setupTool = name => run(setupShell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'setup-tools.ps1'), '-Script', path.join(root, 'scripts/setup-dev-env.ps1'), '-Tool', name, '-Bin', shaderTools], { env: token ? { ...env, GITHUB_TOKEN: token } : env, stdio: 'inherit' });
  fs.mkdirSync(shaderTools, { recursive: true });
  const pythonPackages = path.join(cache, 'python-packages');
  const pathKey = Object.keys(env).find(name => name.toLowerCase() === 'path') || 'Path';
  env[pathKey] = [path.dirname(python), path.dirname(cmake), path.dirname(ninja), shaderTools, path.join(cache, 'slang/bin'), env[pathKey]].join(';');
  env.PYTHONPATH = [pythonPackages, env.PYTHONPATH].filter(Boolean).join(';');
  if (!fs.existsSync(path.join(pythonPackages, 'jinja2'))) run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--target', pythonPackages, 'Jinja2==3.1.6'], { env, stdio: 'inherit' });
  if (!fs.existsSync(path.join(shaderTools, 'dxc.exe'))) setupTool('dxc');
  if (![process.env.QAQR_SLANG, path.join(cache, 'slang/bin/slangc.exe'), path.join(shaderTools, 'slangc.exe')].some(file => file && fs.existsSync(file))) setupTool('slang');
  const slang = tool('slangc.exe', [process.env.QAQR_SLANG, path.join(cache, 'slang/bin/slangc.exe'), path.join(shaderTools, 'slangc.exe')]);
  const dxc = path.join(shaderTools, 'dxc.exe');
  const kitRoot = path.join(process.env['ProgramFiles(x86)'], 'Windows Kits/10/bin');
  const kit = fs.readdirSync(kitRoot).filter(name => /^10\.0\./.test(name) && fs.existsSync(path.join(kitRoot, name, 'x64/fxc.exe'))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1);
  if (!kit) throw Error('Windows SDK shader compiler is missing');
  fs.mkdirSync(work, { recursive: true });
  const reshade = path.join(root, 'external/reshade');
  if (run('git', ['rev-parse', '--is-shallow-repository'], { cwd: reshade }) === 'true') run('git', ['fetch', '--unshallow', '--tags', '--no-recurse-submodules', 'origin'], { cwd: reshade });
  if (fs.existsSync(path.join(reshade, 'res/version.h'))) fs.unlinkSync(path.join(reshade, 'res/version.h'));
  run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(reshade, 'tools/update_version.ps1'), path.join(reshade, 'res/version.h')], { cwd: reshade, env });
  const buildDirectory = path.join(work, 'renodx');
  run(cmake, ['-S', root, '-B', buildDirectory, '-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release', '-DCMAKE_MAKE_PROGRAM=' + ninja, '-DCMAKE_SYSTEM_VERSION=' + kit, '-DRENODX_ADDON_FILTER=endfield', '-DFXC_BIN=' + path.join(kitRoot, kit, 'x64/fxc.exe'), '-DDXC_BIN=' + dxc, '-DSLANGC_BIN=' + slang], { env, stdio: 'inherit' });
  run(cmake, ['--build', buildDirectory, '--target', 'endfield', '--parallel', '4'], { env, stdio: 'inherit' });
  const reshadeBuild = path.join(work, 'reshade');
  run(cmake, ['-S', reshade, '-B', reshadeBuild, '-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release', '-DCMAKE_MAKE_PROGRAM=' + ninja, '-DRESHADE_FXC_EXECUTABLE=' + path.join(kitRoot, kit, 'x64/fxc.exe')], { env, stdio: 'inherit' });
  run(cmake, ['--build', reshadeBuild, '--target', 'ReShade', '--parallel', '4'], { env, stdio: 'inherit' });
  fs.mkdirSync(output, { recursive: true });
  const entries = {
    'renodx-endfield.addon64': path.join(buildDirectory, 'renodx-endfield.addon64'),
    'dxgi.dll': path.join(reshadeBuild, 'ReShade64.dll'),
    'licenses/RenoDX.txt': path.join(root, 'LICENSE'),
    'licenses/ReShade.txt': path.join(reshade, 'LICENSE.md')
  };
  for (const directory of ['external/Detours', 'external/frozen', 'external/gtl', 'external/json', 'external/minhook', 'external/reshade/deps/imgui', 'external/reshade/deps/minhook', 'external/reshade/deps/stb', 'external/reshade/deps/glad', 'external/reshade/deps/utfcpp', 'external/reshade/deps/spirv', 'external/reshade/deps/vma', 'external/reshade/deps/fpng', 'external/reshade/deps/d3d12', 'external/reshade/deps/openxr', 'external/reshade/deps/openvr', 'external/reshade/deps/jxl_simple_lossless']) {
    for (const name of fs.readdirSync(path.join(root, directory))) if (/^(?:license|copying|copyright)(?:[._-].*)?$/i.test(name) && fs.statSync(path.join(root, directory, name)).isFile()) entries['licenses/' + directory.replaceAll('/', '_') + '-' + name] = path.join(root, directory, name);
  }
  const files = {};
  for (const [relative, source] of Object.entries(entries)) {
    const bytes = fs.readFileSync(source);
    fs.mkdirSync(path.dirname(path.join(output, relative)), { recursive: true });
    fs.writeFileSync(path.join(output, relative), bytes);
    files[relative] = crypto.createHash('sha256').update(bytes).digest('hex');
  }
  const sourceCommit = run('git', ['rev-parse', 'HEAD']);
  const upstream = 'refs/remotes/upstream/main';
  if (spawnSync('git', ['show-ref', '--verify', '--quiet', upstream], { cwd: root, windowsHide: true }).status !== 0) {
    run('git', ['fetch', '--no-tags', '--no-recurse-submodules', 'https://github.com/clshortfuse/renodx.git', 'refs/heads/main:' + upstream]);
  }
  const base = run('git', ['merge-base', 'HEAD', upstream]);
  const version = '0.1.0.' + run('git', ['rev-list', '--count', '--no-merges', '--author=qaq-revival-publisher', base + '..HEAD']);
  const reshadeVersion = /VERSION_STRING_PRODUCT "([^"]+)"/.exec(fs.readFileSync(path.join(reshade, 'res/version.h'), 'utf8'))?.[1];
  const manifest = { source: 'https://github.com/QAQ-Revival/renodx', sourceCommit, version, backend: 'd3d11', reshade: { source: 'https://github.com/QAQ-Revival/reshade', sourceCommit: run('git', ['rev-parse', 'HEAD'], { cwd: reshade }), version: reshadeVersion }, files };
  fs.writeFileSync(path.join(output, 'component.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log('Built Endfield HDR ' + version + ' (' + sourceCommit.slice(0, 12) + ')');
  return manifest;
}
if (require.main === module) build();
module.exports = { build };
