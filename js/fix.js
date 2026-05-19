const fs = require('fs');
const path = require('path');
const htmlDir = path.join(process.cwd(), 'html');
const cssDir = path.join(process.cwd(), 'css');
const jsDir = path.join(process.cwd(), 'js');

let htmlChanges = 0;
const htmlFiles = fs.readdirSync(htmlDir).filter(f => f.endsWith('.html'));
for (const file of htmlFiles) {
    const filePath = path.join(htmlDir, file);
    let content = fs.readFileSync(filePath, 'utf8');
    let original = content;

    content = content.replace(/href=["'](?:\.\/)?(?:css\/)?([^/"']+\.css)["']/g, 'href="../css/$1"');
    content = content.replace(/src=["'](?:\.\/)?(?:js\/)?([^/"']+\.js)["']/g, 'src="../js/$1"');
    content = content.replace(/src=["'](?:\.\/)?(?:images\/)([^/"']+)["']/g, 'src="../images/$1"');

    if (content !== original) {
        fs.writeFileSync(filePath, content);
        htmlChanges++;
    }
}

let cssChanges = 0;
const cssFiles = fs.readdirSync(cssDir).filter(f => f.endsWith('.css'));
for (const file of cssFiles) {
    const filePath = path.join(cssDir, file);
    let content = fs.readFileSync(filePath, 'utf8');
    let original = content;

    content = content.replace(/url\(['"]?images\/([^'"\)]+)['"]?\)/g, "url('../images/$1')");

    if (content !== original) {
        fs.writeFileSync(filePath, content);
        cssChanges++;
    }
}

let jsChanges = 0;
const jsFiles = fs.readdirSync(jsDir).filter(f => f.endsWith('.js'));
for (const file of jsFiles) {
    const filePath = path.join(jsDir, file);
    let content = fs.readFileSync(filePath, 'utf8');
    let original = content;

    content = content.replace(/['"]css\/report-modal\.css['"]/g, "'../css/report-modal.css'");

    if (content !== original) {
        fs.writeFileSync(filePath, content);
        jsChanges++;
    }
}

console.log('HTML files modified:', htmlChanges);
console.log('CSS files modified:', cssChanges);
console.log('JS files modified:', jsChanges);
