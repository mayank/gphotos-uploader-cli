var
	CLI 	= require('cli-interact'),
	chalk 	= require('chalk'),
	f 		= require('figures'),
	spinner = require('cli-spinner').Spinner,
	api 	= require('googleapis').google,
	q 		= require('cli-interact'),
	req     = require('request'),
	prog 	= require('cli-progress'),
	path    = require('path'),
	upFiles = [],
	acToken = '',
	count   = 0,
	FS 		= require('fs');


var bar = new prog.Bar({}, prog.Presets.shades_classic);

var fancy = function(color, err, t){
	console.log(chalk[color]((t || '') + ' ' + err));
}


var spin = new spinner();
spin.setSpinnerString('⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏');

fancy('cyan','Reading Google Project Credentials')
//spin.setSpinnerTitle(chalk.cyan('Reading Google Project Credentials'));
//spin.start();



var readCredentials = function(){

	return new Promise(function(resolve, reject) {
		FS.readFile('credentials.json', function(err, data){
			if(err){
				fancy('red', 'Unable to read file credentials.json', f.cross)
				return reject(err);
			}
			else {
				try{
					var body = JSON.parse(data);
					fancy('green', 'Credentials Found', f.tick);
					return resolve(body);
				}catch(err){
					fancy('red', 'Invalid JSON found in credentials.json', f.cross);
					return reject(err);
				}
			}
		});
	});
}

var showGoogleUrl = function(conf) {
	fancy('yellow', 'Asking For Google Token');

	var client = new api.auth.OAuth2(
		conf.installed.client_id,
		conf.installed.client_secret,
		conf.installed.redirect_uris[0],
	);

	var url = client.generateAuthUrl({
		access_type: 'offline',
		scope: [
			'https://www.googleapis.com/auth/photoslibrary.appendonly'
		]
	});

	fancy('green', 'Open Url in Browser and get Token', f.play);
	fancy('underline', url);

	return Promise.resolve(client);
}

var askForToken = function(client){
	return new Promise(function(resolve, reject){
		fancy('cyan', '[Google Auth] Please enter the Token generated', f.play);
		var code = q.question('');
		client.getToken(code)
			.then(function(token){
				fancy('green', 'Valid Token', f.tick);
				acToken = token.tokens.access_token;
				resolve();
			})
			.catch(function(err){
				fancy('red', 'Token not Valid', f.cross)
				reject();
			});
	});
}

var askForFolder = function(){
	fancy('cyan', '[Folder] Please enter the Folder Path to upload', f.circle);
	return Promise.resolve(q.question(''));
}

var showFailures = function(err) {
	spin.stop();
}

var readDirectoryRecursive = function(dir, child) {
	return new Promise(function(resolve, reject){
		FS.readdir(dir, function(err, files){
			if(err){
				fancy('red', 'Invalid Directory Path: ' + dir, f.cross);
				return reject();
			} else {
				var promises = [];

				files.forEach(function(file){
					if(file.indexOf('.') !== 0){
						if(FS.lstatSync(dir + '/' + file).isDirectory()){
							promises.push(readDirectoryRecursive(dir + '/' + file, true));
						} else if(['.jpg', '.png', '.gif'].indexOf(path.extname(dir + '/' + file).toLowerCase()) >= 0){
							upFiles.push(dir + '/' + file);
							count++;
						}
					}
				});

				Promise.all(promises).then(function(){
					return resolve();
				});
			}
		});
	});
}

var uploadBytes = function(file){
	return new Promise(function(resolve, reject){
		req({
			url: 'https://photoslibrary.googleapis.com/v1/uploads',
			method:'POST',
			headers: {
				'Content-Type': 'application/octet-stream',
				'Authorization': 'Bearer ' + acToken,
				'X-Goog-Upload-File-Name': path.basename(file)
			},
			body: FS.createReadStream(file)
		}, function(err, resp, body){
			bar.increment(1);
			if(resp.statusCode == 200){
				resolve(body);
			}else {
				fancy('red', 'Unable to upload file: ' + file);
				reject();
			}
		});
	});
}

var createMedia = function(file, token){
	return new Promise(function(resolve, reject){
		req({
			url: 'https://photoslibrary.googleapis.com/v1/mediaItems:batchCreate',
			method:'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': 'Bearer ' + acToken
			},
			body: {
			  "newMediaItems": [{
			      "description": path.basename(file),
			      "simpleMediaItem": {
			        "uploadToken": token
			      }
			    }]
			},
			json: true
		}, function(error, response, json){
			bar.increment(1);
			if(error || response.statusCode !== 200){
				fancy('red', 'Unable create media: ' + token);
				reject();
			}
			else {
				resolve();
			}
		});
	});
}

var uploadFilesToGoogleDrive = function(){
	return new Promise(function(resolve, reject){
		if(count > 0){
			fancy('green', count + ' Files Found, Uploading Now!', f.play);
			bar.start(count*3, 0);
			var promises = [];

			upFiles.forEach(function(file){
				promises.push(new Promise(function(res, rej){
					uploadBytes(file)
						.then(function(token){
							return createMedia(file, token);
						})
						.then(function(){
							bar.increment(1);
							resolve();
						})
						.catch(function(){
							bar.increment(1);
							reject();
						});
				}));
			});

			Promise.all(promises).then(function(){
				return resolve();
			});

		} else {
			fancy('red', 'No Image Files found in Folder', f.cross);
			return reject();
		}
	});
}


readCredentials()
	.then(function(d){ return showGoogleUrl(d) })
	.then(function(c){ return askForToken(c) })
	.then(function(){
		return askForFolder();
	 })
	.then(function(path){
		files = [];
		count = 0;
		return readDirectoryRecursive(path, false);
	})
	.then(function(){
		return uploadFilesToGoogleDrive();
	})
	.then(function(){
		bar.stop();
	})
	.catch(function(e){ return showFailures(e) })
