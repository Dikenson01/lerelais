const { spawn } = require('child_process');
const path = require('path');

function runCommand(command, args, cwd, name) {
  const child = spawn(command, args, { 
    cwd: path.resolve(__dirname, cwd),
    shell: true,
    stdio: 'inherit',
    env: { ...process.env, PATH: `${process.env.PATH}:/usr/local/bin:/opt/homebrew/bin` }
  });

  child.on('error', (err) => console.error(`[${name}] Error:`, err));
  return child;
}

console.log('--- Starting LeRelais Hub Development Environment ---');

// 1. Start Backend
const backend = runCommand('node', ['src/index.js'], './', 'Backend');

// 2. Start Frontend
const frontend = runCommand('npm', ['run', 'dev'], './web', 'Frontend');

process.on('SIGINT', () => {
  backend.kill();
  frontend.kill();
  process.exit();
});
