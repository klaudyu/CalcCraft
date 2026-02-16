import { copyFileSync } from 'fs';
import { existsSync, mkdirSync } from 'fs';

//const filesToCopy = ['manifest.json', 'README.md', 'main.js'];
const filesToCopy = ['manifest.json', 'main.js'];
const distDir = './dist';


if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
  console.log('Directory dist created');
} else {
  console.log('Directory dist already exists');
}

copyFileSync('styles.css', 'dist/styles.css');

filesToCopy.forEach(file => {
  copyFileSync(file, `${distDir}/${file}`);
});
