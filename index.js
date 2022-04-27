'use strict';

/***
    Usage: blog2md b|w <BLOGGER/WordPress BACKUP XML> <OUTPUT DIR>

*/


const fs = require('fs');
const os = require('os');
const path = require('path');
const xml2js = require('xml2js');
const sanitize = require('sanitize-filename');
const moment = require('moment');
const http = require('http');
const striptags = require('striptags');
const TurndownService = require('@joplin/turndown')
const turndownPluginGfm = require('@joplin/turndown-plugin-gfm')

const tds = new TurndownService({ codeBlockStyle: 'fenced', fence: '```' })

tds.use(turndownPluginGfm.gfm)

tds.addRule('wppreblock', {
    filter: ['pre'],
    replacement: function(content, node) {
        var out = striptags(node.outerHTML, '<br>')
        out = striptags(out, ['<br>'], '\n')
        return '```\n' + out + '\n```'
    }
})


var count = 0;
var postFileLocation = '';
tds.addRule('base64img', {
    filter: ['img'],
    replacement: function (content, node) {
        var src = node.src
        if(src.startsWith('data:image/png;base64,')) {
            count++;
            src = src.replace('data:image/png;base64,', '').replace(/[^-a-z0-9+/=]/gi,'');

            var imageFilePrefix = postFileLocation.replace('.md', '')
            var imagePathAndFilename = imageFilePrefix+count+".png";
            fs.writeFile(imagePathAndFilename, src, 'base64', function(err) {
                console.log(err);
            });
            var filename = imagePathAndFilename.substring(imagePathAndFilename.lastIndexOf("/") + 1);
            return `{{<imglink title="Image" src="${filename}" size="500x500">}})`;
        }
        return `![Image alt](${src})`;
    }
})

tds.addRule('images', {
    filter: ['a'],
    replacement: function(content, node) {
        var imgNode = node.getElementsByTagName('img');
        if(imgNode.length > 0) {
            count++;
            var imgURL = node.href
            var sourceURL = new URL(imgURL)

            var imageFilePrefix = postFileLocation.replace('.md', '')
            var imageFileType = sourceURL.pathname.substring(sourceURL.pathname.lastIndexOf('.')+1);
            var imagePathAndFilename = imageFilePrefix + count + "." + imageFileType;

            download(imgURL, imagePathAndFilename)
            
            var filename = imagePathAndFilename.substring(imagePathAndFilename.lastIndexOf("/") + 1);
            return `{{<imglink title="Image" src="${filename}" size="500x500">}})`;
        }
        
        return `![${node.innerHTML}](${node.href})`
    }
})

function download(srcURL, dest) {
    http.get(srcURL, (res) => {

        // Open file in local filesystem
        const file = fs.createWriteStream(dest);
    
        // Write data into local file
        res.pipe(file);
    
        // Close the file
        file.on('finish', () => {
            file.close();
            console.log(`File downloaded!`);
        });
    
    }).on("error", (err) => {
        console.log("Error: ", err.message);
    });
};

// console.log(`No. of arguments passed: ${process.argv.length}`);

if (process.argv.length < 5){
    // ${process.argv[1]}
    console.log(`Usage:`);
    console.log(`\tnode index.js <b|w> <BACKUP_XML> <OUTPUT_DIR> [m|s] [paragraph-fix] [create-page-bundles]`)
    console.log(`Where:`);
    console.log(`\t b|w - Indicates the source type to process, b = Blogger, w = WordPress`);
    console.log(`\t BACKUP_XML - Name of the backup file to process. Include the path in another directory`);
    console.log(`\t OUTPUT_DIR - Output directory relative to the current directory`);
    console.log(`Optional:`);
    console.log(`\t m|s - Indicates whether to include comments in the post file or a separate file`);
    console.log(`\t paragraph-fix - Include this to fix WordPress posts by converting newlines to paragraphs`);
    console.log(`\t create-page-bundles - Include this to output in page bundles`);
    console.log(`Examples:`);
    console.log(`\t node index.js b blog-03-21-2022.xml out`);
    console.log(`\t node index.js b blog-03-21-2022.xml out m`);
    console.log(`\t node index.js b blog-03-21-2022.xml out create-page-bundles`);
    return 1;
}

var option = process.argv[2];
var inputFile =  process.argv[3];

var outputDir = process.argv[4];

var mergeComments = (process.argv[5] == 'm')?'m':'s' ;
/** Apply a fix to WordPress posts to convert newlines to paragraphs. */
var applyParagraphFix = (process.argv.indexOf('paragraph-fix') >= 0);

/** Indicate whether files should be output to page bundle directories i.e. content/post-name/index.md */
var createPageBundles = (process.argv.indexOf('create-page-bundles') >= 0);


if (fs.existsSync(outputDir)) {
    console.log(`WARNING: Given output directory "${outputDir}" already exists. Files will be overwritten.`)
}
else{
    fs.mkdirSync(outputDir);
}


if (mergeComments == 'm'){
    console.log(`INFO: Comments requested to be merged along with posts. (m)`);
}
else{
    console.log(`INFO: Comments requested to be a separate .md file(m - default)`);
}



if( option.toLowerCase() == 'b'){
    bloggerImport(inputFile, outputDir);
}
else if(option.toLowerCase() == 'w'){
    wordpressImport(inputFile, outputDir);
}
else {
    console.log('Only b (Blogger) and w (WordPress) are valid options');
    return;
}





function wordpressImport(backupXmlFile, outputDir){
    var parser = new xml2js.Parser();

    fs.readFile(backupXmlFile, function(err, data) {
        parser.parseString(data, function (err, result) {
            if (err) {
                console.log(`Error parsing xml file (${backupXmlFile})\n${JSON.stringify(err)}`); 
                return 1;
            }
            // console.dir(result); 
            // console.log(JSON.stringify(result)); return;
            var posts = [];
            
            // try {
                posts = result.rss.channel[0].item;
                
                console.log(`Total Post count: ${posts.length}`);

                posts = posts.filter(function(post){
                    var status = '';
                    if(post["wp:status"]){
                        status = post["wp:status"].join(''); 
                    }
                    // console.log(post["wp:status"].join(''));
                    return status != "private" && status != "inherit" 
                });


                // console.log(posts)
                console.log(`Post count: ${posts.length}`);

                var title = '';
                var content = '';
                var tags = [];
                var draft = false;
                var published = '';
                var comments = [];
                var fname = '';
                var markdown = '';
                var fileContent = '';
                var fileHeader = '';
                var postMaps = {};
                
                posts.forEach(function(post){
                    var postMap = {};

                    title = post.title[0].trim();
                    
                    // console.log(title);

                    // if (title && title.indexOf("'")!=-1){
                    title = title.replace(/'/g, "''");
                    // }

                    draft = post["wp:status"] == "draft"
                    published = post.pubDate;
                    comments = post['wp:comment'];
                    fname = sanitize(decodeURI(post["wp:post_name"][0])) || post["wp:post_id"];
                    markdown = '';
                    // if (post.guid && post.guid[0] && post.guid[0]['_']){
                    //     fname = path.basename(post.guid[0]['_']);
                    // }
                    // console.log(comments);

                    console.log(`\n\n\n\ntitle: '${title}'`);
                    console.log(`published: '${published}'`);
                    
                    if (comments){
                        console.log(`comments: '${comments.length}'`);    
                    }
                    
                    tags = [];

                    var categories = post.category;
                    var tagString = '';

                    if (categories && categories.length){
                        categories.forEach(function (category){
                            // console.log(category['_']);
                            tags.push(category['_']);
                        });

                        // console.log(tags.join(", "));
                        // tags = tags.join(", ");
                        tagString = 'tags: [\'' + tags.join("', '") + "']\n";
                        // console.log(tagString);
                    }

                    var postOutput = getPostOutput(fname);
                    postMap.postName = postOutput.postName
                    postMap.fname = postOutput.fname;
                    postMap.comments = [];
                    
                    if (post["content:encoded"]){
                        // console.log('content available');
                        var postContent = post["content:encoded"].toString();
                        if (applyParagraphFix && !/<p>/i.test(postContent)) {
                            postContent = '<p>' + postContent.replace(/(\r?\n){2}/g, '</p>\n\n<p>') + '</p>';
                        }
                        content = '<div>'+postContent+'</div>'; //to resolve error if plain text returned
                        count = 0;
                        postFileLocation = postMap.postName;
                        markdown = tds.turndown(content);
                        // console.log(markdown);

                        fileHeader = `---\ntitle: '${title}'\ndate: ${published}\ndraft: ${draft}\n${tagString}---\n`;
                        fileContent = `${fileHeader}\n${markdown}`;
                        postMap.header = `${fileHeader}\n`;

                        writeToFile(postOutput.postName, fileContent);
                        
                    }

                    //comments:
                    /*
                        "wp:comment" [.each]
                            wp:comment_author[0]
                            wp:comment_author_email[0]
                            wp:comment_author_url[0]
                            wp:comment_date[0]
                            wp:comment_content[0]
                            wp:comment_approved[0] == 1
                        wp:post_id

                    */
                    var comments = post["wp:comment"] || [];
                    // console.dir(comments);
                    var anyApprovedComments = 0;
                    var ccontent = '';
                    comments.forEach(function(comment){
                        // console.log('')
                        if(comment["wp:comment_approved"].pop()){
                            anyApprovedComments = 1;

                            var cmt = {title:'', published:'', content:'', author:{}};

                            cmt.published = (comment["wp:comment_date"]?comment["wp:comment_date"].pop():'');

                            var cont = '<div>'+comment["wp:comment_content"].pop()+'</div>';
                            cmt.content = (comment["wp:comment_content"]?tds.turndown(cont):'');

                            cmt.author.name = (comment["wp:comment_author"]?comment["wp:comment_author"].pop():'');
                            cmt.author.email = (comment["wp:comment_author_email"]?comment["wp:comment_author_email"].pop():'');
                            cmt.author.url = (comment["wp:comment_author_url"]?comment["wp:comment_author_url"].pop():'');

                            ccontent += `#### [${cmt.author.name}](${cmt.author.url} "${cmt.author.email}") - ${cmt.published}\n\n${cmt.content}\n<hr />\n`;

                            postMap.comments.push(cmt);
                        }
                    });

                    //just a hack to re-use blogger writecomments method
                    if (postMap && postMap.comments && postMap.comments.length){
                        writeComments({"0": postMap});
                    }

                });

        });
    });

}




function getFileName(text) {
    var newFileName = sanitize(text)     // first remove any dodgy characters
            .replace(/[\.']/g, '')       // then remove some known characters
            .replace(/[^a-z0-9]/gi, '-') // then turn anything that isn't a number or letter into a hyphen
            .replace(/[\-]{2,}/g, '-')   // then turn multiple hyphens into a single one
            .toLowerCase();              // finally make it all lower case
    return newFileName;
}

function getPostOutput(sanitizedTitle) {
    var postOutput = {};
    
    var entryFolder = outputDir;
    if(createPageBundles) {
        entryFolder = outputDir + '/' + sanitizedTitle;
    }

    if (!fs.existsSync(entryFolder)) {
        fs.mkdirSync(entryFolder);
    }

    var postName = entryFolder + '/' + sanitizedTitle + '.md';
    if(createPageBundles) {
        postName = entryFolder + '/index.md';
    }

    var fname = postName.replace('.md', '-comments.md')
    if(createPageBundles) {
        fname = entryFolder + '/comments.md';
    }
    
    postOutput.postName = postName;
    postOutput.fname = fname;
    return postOutput;
}

 
function bloggerImport(backupXmlFile, outputDir){
    var parser = new xml2js.Parser();
    // __dirname + '/foo.xml'
    fs.readFile(backupXmlFile, function(err, data) {
        parser.parseString(data, function (err, result) {
            if (err){
                console.log(`Error parsing xml file (${backupXmlFile})\n${JSON.stringify(err)}`); return 1;
            }
            // console.dir(JSON.stringify(result)); return;

            if(result.feed && result.feed.entry) {
                var contents = result.feed.entry;
                console.log(`Total no. of entries found : ${contents.length}`);
                // var i=0
                var posts = contents.filter(function(entry){
                    return entry.id[0].indexOf('.post-')!=-1 && !entry['thr:in-reply-to']
                });

                var comments = contents.filter(function(entry){
                    return entry.id[0].indexOf('.post-')!=-1 && entry['thr:in-reply-to']
                });

                // console.dir(posts);

                console.log(`Content-posts ${posts.length}`);
                console.log(`Content-Comments ${comments.length}`);

                 var content = '';
                 var markdown = '';
                 var fileContent = '';
                 var fileHeader = '';
                 var postMaps = {};

                posts.forEach(function(entry){
                    var postMap = {};
                    
                    var title = entry.title[0]['_'];
                    // title = tds.turndown(title);
                    if (title && title.indexOf("'")!=-1){
                         title = title.replace(/'/g, "''");
                    }
                    postMap.pid = entry.id[0].split('-').pop()

                    var published = entry.published;
                    var draft = 'false';
                    if(entry['app:control'] && (entry['app:control'][0]['app:draft'][0] == 'yes')){
                        draft =  'true';
                    }

                    console.log(`title: "${title}"`);
                    console.log(`date: ${published}`);
                    console.log(`draft: ${draft}`);
                    
                    var sanitizedTitle = getFileName(title)

                    var urlLink = entry.link.filter(function(link){
                        return link["$"].type && link["$"].rel && link["$"].rel=='alternate' && link["$"].type=='text/html'
                    });

                    var url=''

                    // console.dir(urlLink[0]);
                    if (urlLink && urlLink[0] && urlLink[0]['$'] && urlLink[0]['$'].href){
                        url = urlLink[0]['$'].href;
                    }

                    var postOutput = getPostOutput(sanitizedTitle);
                    postMap.postName = postOutput.postName
                    postMap.fname = postOutput.fname;
                    postMap.comments = [];


                    if (entry.content && entry.content[0] && entry.content[0]['_']){
                        // console.log('content available');
                        content = entry.content[0]['_'];
                        count = 0;
                        postFileLocation = postMap.postName;
                        markdown = tds.turndown(content);
                        // console.log(markdown);
                    }

                    var tagLabel = [];
                    var tags = [];

                    
                    tagLabel = entry.category.filter(function (tag){
                        // console.log(`tagged against :${tag['$'].term}`);
                        return tag['$'].term && tag['$'].term.indexOf('http://schemas.google')==-1;
                    });
                    console.log(`No of category: ${entry.category.length}`);
                    tagLabel.forEach(function(tag){
                        // console.log(`tagged against :${tag['$'].term}`);
                        tags.push(tag['$'].term);
                    });
                    

                    console.log(`tags: \n${tags.map(a=> '- '+a).join('\n')}\n`);

                    var tagString='';

                    if(tags.length){
                        tagString=`tags: \n${tags.map(a=> '- '+a).join('\n')}\n`;
                    }

                    console.dir(postMap);

                    console.log("\n\n\n\n\n");

                    var alias = url.replace(/^.*\/\/[^\/]+/, '');

                    fileHeader = `---\ntitle: '${title}'\ndate: ${published}\ndraft: ${draft}\nurl: ${alias}\n${tagString}---\n`;
                    fileContent = `${fileHeader}\n${markdown}`;

                    postMap.header = fileHeader;
                    postMaps[postMap.pid] = postMap;

                    writeToFile(postOutput.postName, fileContent)
                    
                });


            comments.forEach(function(entry){
                // var commentMap = {};
                var comment = {published:'', title:'', content:''};

                var postId = entry['thr:in-reply-to'][0]["$"]["source"];
                postId = path.basename(postId);

                comment.published = entry['published'][0];

                if(entry['title'][0] && entry['title'][0]["_"]){
                    comment.title = tds.turndown(entry['title'][0]["_"]);    
                }

                if (entry['content'][0] && entry['content'][0]["_"]){
                    comment.content = tds.turndown(entry['content'][0]["_"]);    
                }
                
                comment.author = {name: '', email: '', url: ''};
                
                if(entry['author'][0]["name"] && entry['author'][0]["name"][0]){
                    comment.author.name = entry['author'][0]["name"][0];    
                }
                
                if (entry['author'][0]["email"] && entry['author'][0]["email"][0]){
                    comment.author.email = entry['author'][0]["email"][0];    
                }
                
                if (entry['author'][0]["uri"] && entry['author'][0]["uri"][0]){
                    comment.author.url = entry['author'][0]["uri"][0];    
                }
                
                postMaps[postId].comments.push(comment);
            });

            // console.log(JSON.stringify(postMaps)); return;
            writeComments(postMaps);
           
            }
            console.log('Done');
        });
});

}


function writeComments(postMaps){

    if (mergeComments == 'm'){
        console.log('DEBUG: merge comments requested');
    }else{
        console.log('DEBUG: separate comments requested (defaulted)');
    }
    for (var pmap in postMaps){
        var comments = postMaps[pmap].comments;
        console.log(`post id: ${pmap} has ${comments.length} comments`);
        // console.dir(comments);

        if (comments.length){
            var ccontent = '';
            comments.forEach(function(comment){
                var readableDate = '<time datetime="'+comment.published+'">' + moment(comment.published).format("MMM d, YYYY") + '</time>';

                ccontent += `#### ${comment.title}\n[${comment.author.name}](${comment.author.url} "${comment.author.email}") - ${readableDate}\n\n${comment.content}\n<hr />\n`;
            });

            if (mergeComments == 'm'){
                writeToFile(postMaps[pmap].postName, `\n---\n### Comments:\n${ccontent}`, true);
            }else{
                writeToFile(postMaps[pmap].fname, `${postMaps[pmap].header}\n${ccontent}`);
            }
            
        }
    }
}



function writeToFile(filename, content, append=false){

    if(append){
        console.log(`DEBUG: going to append to ${filename}`);
        try{
            fs.appendFileSync(filename, content);
            console.log(`Successfully appended to ${filename}`);
        }
        catch(err){
            console.log(`Error while appending to ${filename} - ${JSON.stringify(err)}`);
            console.dir(err);
        }

    }else{
        console.log(`DEBUG: going to write to ${filename}`);
        try{
            fs.writeFileSync(filename, content);
            console.log(`Successfully written to ${filename}`);
        }
        catch(err){
            console.log(`Error while writing to ${filename} - ${JSON.stringify(err)}`);
            console.dir(err);
        }
    }
    
}
