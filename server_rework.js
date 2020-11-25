'use strict';

const os = require('os');

// --- dir stuff ---
const fs = require('fs');
const path = require('path');

// --- server stuff ---
const http = require("http");
const https = require("https");
const express = require('express');
const socketIo = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const md5 = require('md5');
const randomColor = require('randomcolor');

// const authorizedRooms = [];

// --- mediasoup ---
const mediasoup = require("mediasoup");
const supportedRtpCapabilities = require('mediasoup/lib/supportedRtpCapabilities');

const environment = process.env.MODE || 'development';
const serverOptions = require(path.join(__dirname, '/config.json'))[environment];
console.log(`Starting on ${environment} mode.`);

// --- Set up server ---
let sslOptions = {};
if (serverOptions.useHttps) {
	sslOptions.key = fs.readFileSync(path.join(__dirname, serverOptions.httpsKeyFile)).toString();
	sslOptions.cert = fs.readFileSync(path.join(__dirname, serverOptions.httpsCertFile)).toString();
}

const app = express();
const webPort = serverOptions.listenPort;

app.use(express.static('public/assets'));

let webServer = null;
if (serverOptions.useHttps) {
	// -- https ---
	webServer = https.createServer(sslOptions, app).listen(webPort, (error) => {
		if (error) {
			console.log(error);
		} else {
			console.log('Web server start. https://' + serverOptions.hostName + ':' + webServer.address().port + '/');
		}
	});

	// Redirection to https
	let redirector = http.createServer((req, res) => {
		res.writeHead(301, { "Location": "https://" + req.headers['host'] + req.url });
		res.end();
	});

	redirector.listen(serverOptions.httpsRedirectPort, (error) => {
		if (error) {
			console.log(error);
		} else {
			console.log('HTTPS redirector start. http://' + serverOptions.hostName + ':' + redirector.address().port + '/');
		}
	});
} else {
	// --- http ---
	webServer = http.Server(app).listen(webPort, (error) => {
		if (error) {
			console.log(error);
		} else {
			console.log('Web server start. http://' + serverOptions.hostName + ':' + webServer.address().port + '/');
		}
	});
}

app.get('/admin', (req, res) => {
	res.sendFile(path.join(__dirname, 'public/admin.html'));
});

app.get('/create', (req, res) => {
	let roomId = md5(uuidv4());
	// authorizedRooms.push(roomId);
	res.send(roomId);
});

app.get('/t/:id', (req, res) => {
	res.sendFile(path.join(__dirname, 'public/main.html'));
	/*
	if (authorizedRooms.find(id => id === req.params.id)) {
		res.sendFile(path.join(__dirname, 'public/preroom.html'));
	} else {
		res.send('Link inválido.');
	}
	*/
});

app.get('/s/:id', (req, res) => {
	res.sendFile(path.join(__dirname, 'public/main.html'));
});

app.get('*', (req, res) => {
	res.send('Link inválido.');
});

const io = socketIo(webServer);
console.log('socket.io server start. port=' + webPort);

io.on('connection', function (socket) {
	socket.emit('welcome');

	socket.on('join_room', (data) => {

		
	});

	socket.on('disconnect', (data) => {
		
		
	});

	socket.on('error', function (err) {
		console.error('socket ERROR:', err);
	});
});





