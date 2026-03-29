const app = require('./server'); // If server exports app
// Instead I can read server.js and dump lines with app.post
const fs = require('fs');
const data = fs.readFileSync('server.js', 'utf8');
const matches = data.match(/app\.(get|post|put|delete|patch)\s*\(\s*['"](.*?)['"]/g);
console.log(matches);
