import { copyFileSync } from 'fs';
import { existsSync, mkdirSync } from 'fs';

const filesToCopy = ['manifest.json', 'README.md', 'main.js'];
const distDir = './dist';


if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
  console.log('Directory dist created');
} else {
  console.log('Directory dist already exists');
}

copyFileSync('src/styles.css', 'dist/styles.css');
copyFileSync('src/styles.css', 'styles.css');

filesToCopy.forEach(file => {
  copyFileSync(file, `${distDir}/${file}`);
});
