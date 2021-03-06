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
	res.sendFile(path.join(__dirname, 'public/classroom.html'));
	/*
	if (authorizedRooms.find(id => id === req.params.id)) {
		res.sendFile(path.join(__dirname, 'public/preroom.html'));
	} else {
		res.send('Link inválido.');
	}
	*/
});

app.get('/s/:id', (req, res) => {
	res.sendFile(path.join(__dirname, 'public/classroom.html'));
});

app.get('*', (req, res) => {
	res.send('Link inválido.');
});

function startSocket(){
	const io = socketIo(webServer);
	console.log('socket.io server start. port=' + webPort);


	io.on('connection', function (socket) {
		console.log('client connected. socket id=' + getId(socket) + '  , total clients=' + getClientCount());

		socket.on('disconnect', function () {
			const roomname = getRoomname();
			const userId = getId(socket);
			
			// close user connection
			console.log('client disconnected. socket id=' + getId(socket) + '  , total clients=' + getClientCount());
			cleanUpPeer(roomname, socket);

			// const userId = getId(socket);
			// socket.emit('userClosed', { remoteId: userId });

			if (roomname) {
				// console.log('--broadcast room=%s userClosed ---', roomname);
				socket.broadcast.to(roomname).emit('userClosed', { socketId: userId});
			} else {
				console.error('[connection] Room not found: ' + roomname);
			}

			// --- socket.io room ---
			socket.leave(roomname);
		});

		socket.on('error', function (err) {
			console.error('socket ERROR:', err);
		});

		socket.on('connect_error', (err) => {
			console.error('client connection error', err);
		});

		socket.on('getRouterRtpCapabilities', (data, callback) => {
			// const router = defaultRoom.router;
			const roomname = getRoomname();
			const router = getRouter(roomname);

			if (router) {
				// //console.log('getRouterRtpCapabilities: ', router.rtpCapabilities);
				sendResponse(router.rtpCapabilities, callback);
			}
			else {
				sendReject({ text: 'ERROR- router NOT READY' }, callback);
			}
		});

		// --- setup room ---
		socket.on('join_room', async (data, callback) => {
			const roomId = data.roomId;

			const existRoom = Room.getRoom(roomId);
			if (!existRoom) {
				await setupRoom(roomId, '');
				console.log('--- create new room. roomId=' + roomId);
			} else {
				console.log('--- use exist room. roomId=' + roomId);
			}

			console.log('Join room');
			socket.join(roomId);
			setRoomname(roomId);

			callback();
		});

		socket.on('register', async (data, callback) => {
			const roomname = getRoomname();
			const userId = getId(socket);
			const isTeacher = data.isTeacher;

			let allAudioBlocked = isAllAudioBlocked(roomname);
			let allVideoBlocked = isAllVideoBlocked(roomname);

			const user = {
				nickname: data.nickname,
				isTeacher: data.isTeacher,
				color: randomColor({luminosity: 'dark'}),
				audioEnabled: false,
				videoEnabled: false,
				audioBlocked: (allAudioBlocked && !isTeacher),
				videoBlocked: (allVideoBlocked && !isTeacher)
			};
			addUser(roomname, userId, user);

			if (roomname) {
				// console.log('--broadcast room=%s newUser ---', roomname);
				socket.broadcast.to(roomname).emit('newUser', { socketId: userId, user: user});
			} else {
				console.error('[register] Room not found: ' + roomname);
			}

			sendResponse(user, callback);
		});

		// --- producer ----
		socket.on('createProducerTransport', async (data, callback) => {
			const roomname = getRoomname();

			//console.log('-- createProducerTransport ---room=%s', roomname);
			const { transport, params } = await createTransport(roomname);
			addProducerTrasport(roomname, getId(socket), transport);

			transport.observer.on('close', () => {
				const id = getId(socket);
				const videoProducer = getProducer(roomname, id, 'video');
				if (videoProducer) {
					videoProducer.close();
					removeProducer(roomname, id, 'video');
				}
				const audioProducer = getProducer(roomname, id, 'audio');
				if (audioProducer) {
					audioProducer.close();
					removeProducer(roomname, id, 'audio');
				}
				removeProducerTransport(roomname, id);
			});
			////console.log('-- createProducerTransport params:', params);
			sendResponse(params, callback);
		});

		socket.on('connectProducerTransport', async (data, callback) => {
			const roomname = getRoomname();
			const transport = getProducerTrasnport(roomname, getId(socket));
			await transport.connect({ dtlsParameters: data.dtlsParameters });
			sendResponse({}, callback);
		});

		socket.on('produce', async (data, callback) => {
			const roomname = getRoomname();
			const { kind, rtpParameters } = data;
			// console.log('-- produce --- kind=' + kind);

			const id = getId(socket);
			const transport = getProducerTrasnport(roomname, id);
			if (!transport) {
				console.error('transport NOT EXIST for id=' + id);
				return;
			}
			const producer = await transport.produce({ kind, rtpParameters });
			producer.isTeacher = socket.isTeacher;

			addProducer(roomname, id, producer, kind);

			if(kind === 'audio'){
				enableUserAudio(roomname, id);
			} else if(kind === 'video') {
				enableUserVideo(roomname, id);
			}

			producer.observer.on('close', () => {
				//console.log('producer closed --- kind=' + kind);
			})
			sendResponse({ id: producer.id }, callback);

			// inform clients about new producer
			if (roomname) {
				// console.log('--broadcast room=%s newProducer ---', roomname);
				socket.broadcast.to(roomname).emit('newProducer', { socketId: id, producerId: producer.id, kind: producer.kind });
			} else {
				console.error('[produce] Room not found: ' + roomname);
			}

		});

		// --- consumer ----
		socket.on('createConsumerTransport', async (data, callback) => {
			const roomname = getRoomname();

			//console.log('-- createConsumerTransport -- id=' + getId(socket));
			const { transport, params } = await createTransport(roomname);
			addConsumerTrasport(roomname, getId(socket), transport);

			transport.observer.on('close', () => {
				const localId = getId(socket);
				removeConsumerSetDeep(roomname, localId);
				removeConsumerTransport(roomname, lid);
			});

			////console.log('-- createTransport params:', params);
			sendResponse(params, callback);
		});

		socket.on('connectConsumerTransport', async (data, callback) => {
			const roomname = getRoomname();
			//console.log('-- connectConsumerTransport -- id=' + getId(socket));
			let transport = getConsumerTrasnport(roomname, getId(socket));
			if (!transport) {
				console.error('transport NOT EXIST for id=' + getId(socket));
				return;
			}
			await transport.connect({ dtlsParameters: data.dtlsParameters });


			sendResponse({}, callback);
		});

		socket.on('consume', async (data, callback) => {
			console.error('-- ERROR: consume NOT SUPPORTED ---');
			return;
		});

		socket.on('resume', async (data, callback) => {
			console.error('-- ERROR: resume NOT SUPPORTED ---');
			return;
		});

		socket.on('getCurrentRemoteInfo', async (data, callback) => {
			const roomname = getRoomname();
			const clientId = data.localId;

			const remoteVideoIds = getRemoteIds(roomname, clientId, 'video');
			console.log('-- remoteVideoIds:', remoteVideoIds);

			const remoteAudioIds = getRemoteIds(roomname, clientId, 'audio');
			console.log('-- remoteAudioIds:', remoteAudioIds);

			const remoteUsers = getRemoteUsers(roomname, clientId, 'user');
			console.log('-- remoteUsers:', remoteUsers.length);

			sendResponse({ remoteVideoIds: remoteVideoIds, remoteAudioIds: remoteAudioIds, remoteUsers: remoteUsers }, callback);
		});

		socket.on('getChatHistory', async (data, callback) => {
			const roomname = getRoomname();
			const messages = getMessages(roomname);
			// console.log('-- messages:', messages);

			sendResponse({messages: messages}, callback);
		});

		socket.on('consumeAdd', async (data, callback) => {
			const roomname = getRoomname();
			const localId = getId(socket);
			const kind = data.kind;
			// console.log('-- consumeAdd -- localId=%s kind=%s', localId, kind);

			let transport = getConsumerTrasnport(roomname, localId);
			if (!transport) {
				console.error('transport NOT EXIST for id=' + localId);
				return;
			}
			const rtpCapabilities = data.rtpCapabilities;
			const remoteId = data.remoteId;
			// console.log('-- consumeAdd - localId=' + localId + ' remoteId=' + remoteId + ' kind=' + kind);

			const producer = getProducer(roomname, remoteId, kind);
			if (!producer) {
				console.error('producer NOT EXIST for remoteId=%s kind=%s', remoteId, kind);
				return;
			}
			const { consumer, params } = await createConsumer(roomname, transport, producer, rtpCapabilities); // producer must exist before consume

			//subscribeConsumer = consumer;
			addConsumer(roomname, localId, remoteId, consumer, kind); // TODO: MUST comination of  local/remote id

			//console.log('addConsumer localId=%s, remoteId=%s, kind=%s', localId, remoteId, kind);
			consumer.observer.on('close', () => {
				// console.log('consumer closed ---');
			});

			consumer.on('producerclose', () => {
				// console.log('consumer -- on.producerclose');
				consumer.close();
				removeConsumer(roomname, localId, remoteId, kind);

				// -- notify to client ---
				socket.emit('producerClosed', { localId: localId, remoteId: remoteId, kind: kind });
			});

			//console.log('-- consumer ready ---');
			sendResponse(params, callback);
		});

		socket.on('resumeAdd', async (data, callback) => {
			const roomname = getRoomname();
			const localId = getId(socket);
			const remoteId = data.remoteId;
			const kind = data.kind;

			// console.log('-- resumeAdd localId=%s remoteId=%s kind=%s', localId, remoteId, kind);
			let consumer = getConsumer(roomname, localId, remoteId, kind);
			if (!consumer) {
				console.error('consumer NOT EXIST for remoteId=' + remoteId);
				return;
			}
			await consumer.resume();
			sendResponse({}, callback);
		});

		socket.on('chatMessage', async (data, callback) => {
			const roomname = getRoomname();
			const senderId = getId(socket);
			const sender = getUser(roomname, senderId);
			const receiverId = data.id;
			const messagePackage = { id: senderId, name: sender.nickname, color: sender.color, type: data.type, message: data.message };

			if(sender){
				if (roomname) {
					if (receiverId) {
						io.to(receiverId).emit('receiveMessage', messagePackage);
					} else {
						insertMessage(roomname, messagePackage);
						io.in(roomname).emit('receiveMessage', messagePackage);
					}

					// socket.emit('receiveMessage', messagePackage);
					// socket.broadcast.to(roomname).emit('receiveMessage', messagePackage);
				} else {
					console.error('[chatMessage] Room not found: ' + roomname);
				}
	
			} else {
				console.error('user NOT EXIST for remoteId=' + id);
			}
			callback();
		});

		/*
		socket.on('sendAssessmentLink', async (data, callback) => {
			const targetId = data.id;
			const link = data.link;
			const roomname = getRoomname();
			const user = getUser(roomname, targetId);

			if(user){
				io.to(targetId).emit('receiveAssessmentLink', link);
			} else {
				console.error('user NOT EXIST for remoteId=' + id);
			}
			callback();
		});
		*/

		socket.on('stopVideoProducer', async (data, callback) => {
			const roomname = getRoomname();
			const id = getId(socket);
			disableUserVideo(roomname, id);

			const videoProducer = getProducer(roomname, id, 'video');
			if (videoProducer) {
				videoProducer.close();
				removeProducer(roomname, id, 'video');
			}
			callback();
		});

		socket.on('stopAudioProducer', async (data, callback) => {
			const roomname = getRoomname();
			const id = getId(socket);
			disableUserAudio(roomname, id);

			const audioProducer = getProducer(roomname, id, 'audio');
			if (audioProducer) {
				audioProducer.close();
				removeProducer(roomname, id, 'audio');
			}
			callback();
		});

		socket.on('toggleBlockAudio', async (data, callback) => {
			const roomname = getRoomname();
			const id = data.id;
			const isBlocked = isAudioBlocked(roomname, id);

			if(isBlocked){
				if (roomname) {
					unblockAudio(roomname, id);
					io.in(roomname).emit('producerUnblocked', { remoteId: id, kind: 'audio'});
				} else {
					console.error('[toggleBlockAudio] Room not found: ' + roomname);
				}
	
				// socket.emit('producerUnblocked', { remoteId: id, kind: 'audio'});
				// socket.broadcast.emit('producerUnblocked', { remoteId: id, kind: 'audio'});
			} else {
				if (roomname) {
					blockAudio(roomname, id);
					io.in(roomname).emit('producerBlocked', { remoteId: id, kind: 'audio'});
				} else {
					console.error('[toggleBlockAudio] Room not found: ' + roomname);
				}
	
				// socket.emit('producerBlocked', { remoteId: id, kind: 'audio'});
				// socket.broadcast.emit('producerBlocked', { remoteId: id, kind: 'audio'});
			}
			callback();
		});

		socket.on('toggleBlockVideo', async (data, callback) => {
			const roomname = getRoomname();
			const id = data.id;
			const isBlocked = isVideoBlocked(roomname, id);

			if(isBlocked){
				if (roomname) {
					unblockVideo(roomname, id);
					io.in(roomname).emit('producerUnblocked', { remoteId: id, kind: 'video'});
				} else {
					console.error('[toggleBlockVideo] Room not found: ' + roomname);
				}
	
				// socket.emit('producerUnblocked', { remoteId: id, kind: 'video'});
				// socket.broadcast.emit('producerUnblocked', { remoteId: id, kind: 'video'});
			} else {
				if (roomname) {
					blockVideo(roomname, id);
					io.in(roomname).emit('producerBlocked', { remoteId: id, kind: 'video'});
				} else {
					console.error('[toggleBlockVideo] Room not found: ' + roomname);
				}
	
				// socket.emit('producerBlocked', { remoteId: id, kind: 'video'});
				// socket.broadcast.emit('producerBlocked', { remoteId: id, kind: 'video'});
			}
			callback();
		});

		// ---- sendback welcome message with on connected ---
		const newId = getId(socket);
		sendback(socket, { type: 'welcome', id: newId });

		// --- send response to client ---
		function sendResponse(response, callback) {
			////console.log('sendResponse() callback:', callback);
			callback(null, response);
		}

		// --- send error to client ---
		function sendReject(error, callback) {
			callback(error.toString(), null);
		}

		function sendback(socket, message) {
			socket.emit('message', message);
		}

		function setRoomname(room) {
			socket.roomname = room;
		}

		function getRoomname() {
			const room = socket.roomname;
			return room;
		}
	});

	function getId(socket) {
		return socket.id;
	}

	//function sendNotification(socket, message) {
	//  socket.emit('notificatinon', message);
	//}

	function getClientCount() {
		// WARN: undocumented method to get clients number
		return io.eio.clientsCount;
	}

	function cleanUpPeer(roomname, socket) {
		const id = getId(socket);
		removeConsumerSetDeep(roomname, id);
	
		const transport = getConsumerTrasnport(roomname, id);
		if (transport) {
			transport.close();
			removeConsumerTransport(roomname, id);
		}
	
		const videoProducer = getProducer(roomname, id, 'video');
		if (videoProducer) {
			videoProducer.close();
			removeProducer(roomname, id, 'video');
		}

		const audioProducer = getProducer(roomname, id, 'audio');
		if (audioProducer) {
			audioProducer.close();
			removeProducer(roomname, id, 'audio');
		}
	
		const producerTransport = getProducerTrasnport(roomname, id);
		if (producerTransport) {
			producerTransport.close();
			removeProducerTransport(roomname, id);
		}
	
		const user = getUser(roomname, id);
		if (user) {
			removeUser(roomname, id);
		}
	}
}

async function setupRoom(name, label) {
	const room = new Room(name, label);

	const mediaCodecs = mediasoupOptions.router.mediaCodecs;
	const router = await worker.createRouter({ mediaCodecs });
	router.roomname = name;

	router.observer.on('close', () => {
		//console.log('-- router closed. room=%s', name);
	});

	router.observer.on('newtransport', transport => {
		//console.log('-- router newtransport. room=%s', name);
	});

	room.router = router;
	Room.addRoom(room, name);
	return room;
}

// ========= room ===========

class Room {
	constructor(name, label) {
		this.name = name;
		this.label = label;

		this.users = {};
		this.chatHistory = [];

		this.allAudioBlocked = false;
		this.allVideoBlocked = false;

		this.producerTransports = {};
		this.videoProducers = {};
		this.audioProducers = {};

		this.consumerTransports = {};
		this.videoConsumerSets = {};
		this.audioConsumerSets = {};

		this.router = null;
	}

	getRouter(){
		return this.router;
	}

	getProducerTrasnport(id) {
		return this.producerTransports[id];
	}

	addProducerTrasport(id, transport) {
		this.producerTransports[id] = transport;
		//console.log('room=%s producerTransports count=%d', this.name, Object.keys(this.producerTransports).length);
	}

	removeProducerTransport(id) {
		delete this.producerTransports[id];
		//console.log('room=%s producerTransports count=%d', this.name, Object.keys(this.producerTransports).length);
	}

	getRemoteUsers(clientId) {
		let remoteUsers = [];
		for (const key in this.users) {
			if (key !== clientId) {
				let user = this.users[key];
				user.id = key;

				remoteUsers.push(user);
			}
		}
		return remoteUsers;
	}

	getRemoteIds(clientId, kind) {
		let remoteIds = [];
		if (kind === 'video') {
			for (const key in this.videoProducers) {
				if (key !== clientId) {
					remoteIds.push(key);
				}
			}
		} else if (kind === 'audio') {
			for (const key in this.audioProducers) {
				if (key !== clientId) {
					remoteIds.push(key);
				}
			}
		}
		return remoteIds;
	}

	getProducer(id, kind) {
		if (kind === 'video') {
			return this.videoProducers[id];
		}
		else if (kind === 'audio') {
			return this.audioProducers[id];
		}
		else {
			console.warn('UNKNOWN producer kind=' + kind);
		}
	}

	addProducer(id, producer, kind) {
		if (kind === 'video') {
			this.videoProducers[id] = producer;
			//console.log('room=%s videoProducers count=%d', this.name, Object.keys(this.videoProducers).length);
		}
		else if (kind === 'audio') {
			this.audioProducers[id] = producer;
			//console.log('room=%s videoProducers count=%d', this.name, Object.keys(this.audioProducers).length);
		}
		else {
			console.warn('UNKNOWN producer kind=' + kind);
		}
	}

	removeProducer(id, kind) {
		if (kind === 'video') {
			delete this.videoProducers[id];
			//console.log('videoProducers count=' + Object.keys(this.videoProducers).length);
		}
		else if (kind === 'audio') {
			delete this.audioProducers[id];
			//console.log('audioProducers count=' + Object.keys(this.audioProducers).length);
		}
		else {
			console.warn('UNKNOWN producer kind=' + kind);
		}
	}

	getUser(id) {
		return this.users[id];
	}

	addUser(id, user) {
		this.users[id] = user;
	}

	removeUser(id) {
		delete this.users[id];
	}

	enableUserAudio(id){
		this.users[id].audioEnabled = true;
	}
	
	disableUserAudio(id){
		this.users[id].audioEnabled = false;
	}
	
	enableUserVideo(id){
		this.users[id].videoEnabled = true;
	}
	
	disableUserVideo(id){
		this.users[id].videoEnabled = false;
	}

	getConsumerTrasnport(id) {
		return this.consumerTransports[id];
	}

	addConsumerTrasport(id, transport) {
		this.consumerTransports[id] = transport;
		//console.log('room=%s add consumerTransports count=%d', this.name, Object.keys(this.consumerTransports).length);
	}

	removeConsumerTransport(id) {
		delete this.consumerTransports[id];
		//console.log('room=%s remove consumerTransports count=%d', this.name, Object.keys(this.consumerTransports).length);
	}

	getConsumerSet(localId, kind) {
		if (kind === 'video') {
			return this.videoConsumerSets[localId];
		} else if (kind === 'audio') {
			return this.audioConsumerSets[localId];
		}
		else {
			console.warn('WARN: getConsumerSet() UNKNWON kind=%s', kind);
		}
	}

	addConsumerSet(localId, set, kind) {
		if (kind === 'video') {
			this.videoConsumerSets[localId] = set;
		}
		else if (kind === 'audio') {
			this.audioConsumerSets[localId] = set;
		}
		else {
			console.warn('WARN: addConsumerSet() UNKNWON kind=%s', kind);
		}
	}

	removeConsumerSetDeep(localId) {
		const videoSet = this.getConsumerSet(localId, 'video');
		delete this.videoConsumerSets[localId];
		if (videoSet) {
			for (const key in videoSet) {
				const consumer = videoSet[key];
				consumer.close();
				delete videoSet[key];
			}

			// console.log('room=%s removeConsumerSetDeep video consumers count=%d', this.name, Object.keys(videoSet).length);
		}

		const audioSet = this.getConsumerSet(localId, 'audio');
		delete this.audioConsumerSets[localId];
		if (audioSet) {
			for (const key in audioSet) {
				const consumer = audioSet[key];
				consumer.close();
				delete audioSet[key];
			}

			// console.log('room=%s removeConsumerSetDeep audio consumers count=%d', this.name, Object.keys(audioSet).length);
		}
	}

	getConsumer(localId, remoteId, kind) {
		const set = this.getConsumerSet(localId, kind);
		if (set) {
			return set[remoteId];
		}
		else {
			return null;
		}
	}

	addConsumer(localId, remoteId, consumer, kind) {
		const set = this.getConsumerSet(localId, kind);
		if (set) {
			set[remoteId] = consumer;
			//console.log('room=%s consumers kind=%s count=%d', this.name, kind, Object.keys(set).length);
		}
		else {
			//console.log('room=%s new set for kind=%s, localId=%s', this.name, kind, localId);
			const newSet = {};
			newSet[remoteId] = consumer;
			this.addConsumerSet(localId, newSet, kind);
			//console.log('room=%s consumers kind=%s count=%d', this.name, kind, Object.keys(newSet).length);
		}
	}

	removeConsumer(localId, remoteId, kind) {
		const set = this.getConsumerSet(localId, kind);
		if (set) {
			delete set[remoteId];
			// console.log('room=%s consumers kind=%s count=%d', this.name, kind, Object.keys(set).length);
		}
		else {
			// console.log('NO set for room=%s kind=%s, localId=%s', this.name, kind, localId);
		}
	}

	isAudioBlocked(id){
		return this.users[id].audioBlocked;
	}

	isVideoBlocked(id){
		return this.users[id].videoBlocked;
	}


	blockAudio(id){
		this.users[id].audioBlocked = true;
	}
	
	unblockAudio(id){
		if(!this.allAudioBlocked){
			this.users[id].audioBlocked = false;
		}
	}
	
	blockVideo(id){
		this.users[id].videoBlocked = true;
	}
	
	unblockVideo(id){
		if(!this.allVideoBlocked){
			this.users[id].videoBlocked = false;
		}
	}
	
	blockAllVideo() {
		for (const key in this.users) {
			if (this.users[key].isTeacher === false) {
				this.users[key].videoBlocked = true;
			}
		}
		this.allVideoBlocked = true;
	}
	
	blockAllAudio() {
		for (const key in this.users) {
			if (this.users[key].isTeacher === false) {
				this.users[key].audioBlocked = true;
			}
		}
		this.allAudioBlocked = true;
	}
	
	unblockAllVideo() {
		for (const key in this.users) {
			if (this.users[key].isTeacher === false) {
				this.users[key].videoBlocked = false;
			}
		}
		this.allVideoBlocked = false;
	}
	
	unblockAllAudio() {
		for (const key in this.users) {
			if (this.users[key].isTeacher === false) {
				this.users[key].audioBlocked = false;
			}
		}
		this.allAudioBlocked = false;
	}
	
	isAllAudioBlocked() {
		return this.allAudioBlocked;
	}
	
	isAllVideoBlocked() {
		return this.allVideoBlocked;
	}

	insertMessage(message){
		this.chatHistory.push(message);
		if(this.chatHistory.length > 300){
			this.chatHistory.shift();
		}
	}

	getMessages(){
		return this.chatHistory;
	}

	// --- static methtod ---
	static staticInit() {
		rooms = {};
	}

	static addRoom(room, name) {
		Room.rooms[name] = room;
	}

	static getRoom(name) {
		return Room.rooms[name];
	}

	static removeRoom(name) {
		delete Room.rooms[name];
	}

}

// -- static member --
Room.rooms = {};

// --- default room ---
// let defaultRoom = null;

// ========= mediasoup ===========
const mediasoupOptions = {
	// Worker settings
	numWorkers: Object.keys(os.cpus()).length,
	worker: {
		rtcMinPort: serverOptions.rtcMinPort,
		rtcMaxPort: serverOptions.rtcMaxPort,
		logLevel: 'warn',
		logTags: [
			'info',
			'ice',
			'dtls',
			'rtp',
			'srtp',
			'rtcp',
			'rtx',
			'bwe',
			'score',
			'simulcast',
			'svc',
			'sctp'
		],
	},
	// Router settings
	router: {
		mediaCodecs:
			[
				{
					kind: 'audio',
					mimeType: 'audio/opus',
					clockRate: 48000,
					channels: 2
				},
				{
					kind: 'video',
					mimeType: 'video/VP8',
					clockRate: 90000,
					parameters:
					{
						'x-google-start-bitrate': 1000
					}
				},
				{
					kind: 'video',
					mimeType: 'video/VP9',
					clockRate: 90000,
					parameters:
					{
						'profile-id': 2,
						'x-google-start-bitrate': 1000
					}
				},
				{
					kind: 'video',
					mimeType: 'video/h264',
					clockRate: 90000,
					parameters:
					{
						'packetization-mode': 1,
						'profile-level-id': '4d0032',
						'level-asymmetry-allowed': 1,
						'x-google-start-bitrate': 1000
					}
				},
				{
					kind: 'video',
					mimeType: 'video/h264',
					clockRate: 90000,
					parameters:
					{
						'packetization-mode': 1,
						'profile-level-id': '42e01f',
						'level-asymmetry-allowed': 1,
						'x-google-start-bitrate': 1000
					}
				}
			]
	},
	// WebRtcTransport settings
	webRtcTransport: {
		listenIps: [
			{ ip: serverOptions.ip, announcedIp: serverOptions.announcedIp }
		],
		enableUdp: true,
		enableTcp: true,
		preferUdp: true,
		/*maxIncomingBitrate: 1500000,*/
		/*initialAvailableOutgoingBitrate: 1000000*/
		initialAvailableOutgoingBitrate: 100000
	}
};

let worker = null;
//let router = null;
//let producerTransport = null;
//let producer = null;
//let consumerTransport = null;
//let subscribeConsumer = null;

async function startWorker() {
	const mediaCodecs = mediasoupOptions.router.mediaCodecs;
	worker = await mediasoup.createWorker();

	//router = await worker.createRouter({ mediaCodecs });
	//producerTransport = await router.createWebRtcTransport(mediasoupOptions.webRtcTransport);

	// defaultRoom = await setupRoom('_default_room', 'default');
	console.log(`Running ${mediasoupOptions.numWorkers} mediasoup Workers...`);
	startSocket();
}

startWorker();

//
// Room {
//   id,
//   transports[],
//   consumers[],
//   producers[],
// }
//

// --- multi-producers --
//let producerTransports = {};
//let videoProducers = {};
//let audioProducers = {};

function getProducerTrasnport(roomname, id) {
	if (roomname) {
		//console.log('=== getProducerTrasnport use room=%s ===', roomname);
		const room = Room.getRoom(roomname);
		return room.getProducerTrasnport(id);
	} else {
		//console.log('=== getProducerTrasnport use defaultRoom room=%s ===', roomname);
		// return defaultRoom.getProducerTrasnport(id);
		console.error('[getProducerTrasnport] Room not found: ' + roomname);
		return null;
	}
}

function addProducerTrasport(roomname, id, transport) {
	if (roomname) {
		const room = Room.getRoom(roomname);
		room.addProducerTrasport(id, transport);
		//console.log('=== addProducerTrasport use room=%s ===', roomname);
	} else {
		// defaultRoom.addProducerTrasport(id, transport);
		//console.log('=== addProducerTrasport use defaultRoom room=%s ===', roomname);
		console.error('[addProducerTrasport] Room not found: ' + roomname);
	}
}

function removeProducerTransport(roomname, id) {
	if (roomname) {
		const room = Room.getRoom(roomname);
		room.removeProducerTransport(id);
	}
	else {
		// defaultRoom.removeProducerTransport(id);
		console.error('[removeProducerTransport] Room not found: ' + roomname);
	}
}


function getRemoteUsers(roomname, clientId) {
	if (roomname) {
		const room = Room.getRoom(roomname);
		return room.getRemoteUsers(clientId);
	} else {
		console.error('[getRemoteUsers] Room not found: ' + roomname);
		return null;
		// return defaultRoom.getRemoteUsers(clientId);
	}
}

function getRemoteIds(roomname, clientId, kind) {
	if (roomname) {
		const room = Room.getRoom(roomname);
		return room.getRemoteIds(clientId, kind);
	} else {
		console.error('[getRemoteIds] Room not found: ' + roomname);
		return null;
		//return defaultRoom.getRemoteIds(clientId, kind);
	}
}

function getProducer(roomname, id, kind) {
	if (roomname) {
		const room = Room.getRoom(roomname);
		return room.getProducer(id, kind);
	}
	else {
		console.error('[getProducer] Room not found: ' + roomname);
		return null;
		// return defaultRoom.getProducer(id, kind);
	}
}

function addProducer(roomname, id, producer, kind) {
	if (roomname) {
		const room = Room.getRoom(roomname);
		room.addProducer(id, producer, kind);
		//console.log('=== addProducer use room=%s ===', roomname);
	}
	else {
		console.error('[addProducer] Room not found: ' + roomname);
		return null;
		// defaultRoom.addProducer(id, producer, kind);
		//console.log('=== addProducer use defaultRoom room=%s ===', roomname);
	}
}

function removeProducer(roomname, id, kind) {
	if (roomname) {
		const room = Room.getRoom(roomname);
		room.removeProducer(id, kind);
	}
	else {
		console.error('[removeProducer] Room not found: ' + roomname);
		// defaultRoom.removeProducer(id, kind);
	}
}

function getUser(roomname, id) {
	if (roomname) {
		const room = Room.getRoom(roomname);
		return room.getUser(id);
	}
	else {
		console.error('[getUser] Room not found: ' + roomname);
		return null;
		// return defaultRoom.getUser(id);
	}
}

function addUser(roomname, id, user) {
	if (roomname) {
		const room = Room.getRoom(roomname);
		return room.addUser(id, user);
	}
	else {
		console.error('[addUser] Room not found: ' + roomname);
		return null;
		// return defaultRoom.addUser(id, user);
	}
}

function removeUser(roomname, id) {
	if (roomname) {
		const room = Room.getRoom(roomname);
		return room.removeUser(id);
	}
	else {
		console.error('[removeUser] Room not found: ' + roomname);
		return null; 
		// return defaultRoom.removeUser(id, user);
	}
}

function enableUserAudio(roomname, id){
	if (roomname) {
		const room = Room.getRoom(roomname);
		return room.enableUserAudio(id);
	}
	else {
		console.error('[enableUserAudio] Room not found: ' + roomname);
		return null;
		// return defaultRoom.enableUserAudio(id);
	}
}

function disableUserAudio(roomname, id){
	if (roomname) {
		const room = Room.getRoom(roomname);
		return room.disableUserAudio(id);
	}
	else {
		console.error('[disableUserAudio] Room not found: ' + roomname);
		return null;
		// return defaultRoom.disableUserAudio(id);
	}
}

function enableUserVideo(roomname, id){
	if (roomname) {
		const room = Room.getRoom(roomname);
		return room.enableUserVideo(id);
	}
	else {
		console.error('[enableUserVideo] Room not found: ' + roomname);
		return null;
		// return defaultRoom.enableUserVideo(id);
	}
}

function disableUserVideo(roomname, id){
	if (roomname) {
		const room = Room.getRoom(roomname);
		return room.disableUserVideo(id);
	}
	else {
		console.error('[disableUserVideo] Room not found: ' + roomname);
		return null;
		// return defaultRoom.disableUserVideo(id);
	}
}

function insertMessage(roomname, message){
	if (roomname) {
		const room = Room.getRoom(roomname);
		return room.insertMessage(message);
	}
	else {
		console.error('[insertMessage] Room not found: ' + roomname);
		return null;
		// return defaultRoom.insertMessage(message);
	}
}

function getMessages(roomname) {
	if (roomname) {
		const room = Room.getRoom(roomname);
		return room.getMessages();
	} else {
		console.error('[getMessages] Room not found: ' + roomname);
		return null;
		// return defaultRoom.getMessages();
	}
}

function blockAudio(roomname, id){
	if (roomname) {
		const room = Room.getRoom(roomname);
		return room.blockAudio(id);
	} else {
		console.error('[blockAudio] Room not found: ' + roomname);
		return null;
		// return defaultRoom.blockAudio(id);
	}
}

function unblockAudio(roomname, id){
	if (roomname) {
		const room = Room.getRoom(roomname);
		return room.unblockAudio(id);
	} else {
		console.error('[unblockAudio] Room not found: ' + roomname);
		return null;
		// return defaultRoom.unblockAudio(id);
	}
}

function blockVideo(roomname, id){
	if (roomname) {
		const room = Room.getRoom(roomname);
		return room.blockVideo(id);
	} else {
		console.error('[blockVideo] Room not found: ' + roomname);
		return null;
		// return defaultRoom.blockVideo(id);
	}
}

function unblockVideo(roomname, id){
	if (roomname) {
		const room = Room.getRoom(roomname);
		return room.unblockVideo(id);
	} else {
		console.error('[unblockVideo] Room not found: ' + roomname);
		return null;
		// return defaultRoom.unblockVideo(id);
	}
}

function blockAllVideo(roomname) {
	if (roomname) {
		const room = Room.getRoom(roomname);
		return room.blockAllVideo();
	} else {
		console.error('[blockAllVideo] Room not found: ' + roomname);
		return null;
		// return defaultRoom.blockAllVideo();
	}
}

function blockAllAudio(roomname) {
	if (roomname) {
		const room = Room.getRoom(roomname);
		return room.blockAllAudio();
	} else {
		console.error('[blockAllAudio] Room not found: ' + roomname);
		return null;
		// return defaultRoom.blockAllAudio();
	}
}

function unblockAllVideo(roomname) {
	if (roomname) {
		const room = Room.getRoom(roomname);
		return room.unblockAllVideo();
	} else {
		console.error('[unblockAllVideo] Room not found: ' + roomname);
		return null;
		// return defaultRoom.unblockAllVideo();
	}
}

function unblockAllAudio(roomname) {
	if (roomname) {
		const room = Room.getRoom(roomname);
		return room.unblockAllVideo();
	} else {
		console.error('[unblockAllAudio] Room not found: ' + roomname);
		return null;
		// return defaultRoom.unblockAllVideo();
	}
}

function isAudioBlocked(roomname, id) {
	if (roomname) {
		const room = Room.getRoom(roomname);
		return room.isAudioBlocked(id);
	} else {
		console.error('[isAudioBlocked] Room not found: ' + roomname);
		return null;
		// return defaultRoom.isAudioBlocked(id);
	}
}

function isVideoBlocked(roomname, id) {
	if (roomname) {
		const room = Room.getRoom(roomname);
		return room.isVideoBlocked(id);
	} else {
		console.error('[isVideoBlocked] Room not found: ' + roomname);
		return null;
		// return defaultRoom.isVideoBlocked(id);
	}
}


function isAllAudioBlocked(roomname) {
	if (roomname) {
		const room = Room.getRoom(roomname);
		return room.isAllAudioBlocked();
	} else {
		console.error('[isAllAudioBlocked] Room not found: ' + roomname);
		return null;
		// return defaultRoom.isAllAudioBlocked();
	}
}

function isAllVideoBlocked(roomname) {
	if (roomname) {
		const room = Room.getRoom(roomname);
		return room.isAllVideoBlocked();
	} else {
		console.error('[isAllVideoBlocked] Room not found: ' + roomname);
		return null;
		// return defaultRoom.isAllVideoBlocked();
	}
}


// --- multi-consumers --
//let consumerTransports = {};
//let videoConsumers = {};
//let audioConsumers = {};

function getConsumerTrasnport(roomname, id) {
	if (roomname) {
		//console.log('=== getConsumerTrasnport use room=%s ===', roomname);
		const room = Room.getRoom(roomname);
		return room.getConsumerTrasnport(id);
	}
	else {
		//console.log('=== getConsumerTrasnport use defaultRoom room=%s ===', roomname);
		console.error('[getConsumerTrasnport] Room not found: ' + roomname);
		return null;
		// return defaultRoom.getConsumerTrasnport(id);
	}
}

function addConsumerTrasport(roomname, id, transport) {
	if (roomname) {
		const room = Room.getRoom(roomname);
		room.addConsumerTrasport(id, transport);
		//console.log('=== addConsumerTrasport use room=%s ===', roomname);
	}
	else {
		console.error('[addConsumerTrasport] Room not found: ' + roomname);
		// defaultRoom.addConsumerTrasport(id, transport);
		//console.log('=== addConsumerTrasport use defaultRoom room=%s ===', roomname);
	}
}

function removeConsumerTransport(roomname, id) {
	if (roomname) {
		const room = Room.getRoom(roomname);
		room.removeConsumerTransport(id);
	}
	else {
		console.error('[removeConsumerTransport] Room not found: ' + roomname);
		// defaultRoom.removeConsumerTransport(id);
	}
}

// function getConsumerSet(localId, kind) {
//   if (kind === 'video') {
//     return videoConsumers[localId];
//   }
//   else if (kind === 'audio') {
//     return audioConsumers[localId];
//   }
//   else {
//     console.warn('WARN: getConsumerSet() UNKNWON kind=%s', kind);
//   }
// }

function getConsumer(roomname, localId, remoteId, kind) {
	if (roomname) {
		const room = Room.getRoom(roomname);
		return room.getConsumer(localId, remoteId, kind);
	}
	else {
		console.error('[getConsumer] Room not found: ' + roomname);
		return null;
		// return defaultRoom.getConsumer(localId, remoteId, kind);
	}
}

function addConsumer(roomname, localId, remoteId, consumer, kind) {
	if (roomname) {
		const room = Room.getRoom(roomname);
		room.addConsumer(localId, remoteId, consumer, kind);
		//console.log('=== addConsumer use room=%s ===', roomname);
	}
	else {
		console.error('[addConsumer] Room not found: ' + roomname);
		// defaultRoom.addConsumer(localId, remoteId, consumer, kind);
		//console.log('=== addConsumer use defaultRoom room=%s ===', roomname);
	}
}

function removeConsumer(roomname, localId, remoteId, kind) {
	if (roomname) {
		const room = Room.getRoom(roomname);
		room.removeConsumer(localId, remoteId, kind);
	}
	else {
		console.error('[removeConsumer] Room not found: ' + roomname);
		// defaultRoom.removeConsumer(localId, remoteId, kind);
	}
}

function removeConsumerSetDeep(roomname, localId) {
	if (roomname) {
		const room = Room.getRoom(roomname);
		room.removeConsumerSetDeep(localId);
	}
	else {
		console.error('[removeConsumerSetDeep] Room not found: ' + roomname);
		// defaultRoom.removeConsumerSetDeep(localId);
	}
}

function getRouter(roomname) {
	if (roomname) {
		const room = Room.getRoom(roomname);
		return room.getRouter();
	}
	else {
		console.error('[getRouter] Room not found: ' + roomname);
		return null;
		// return defaultRoom.getConsumer(localId, remoteId, kind);
	}
}

async function createTransport(roomname) {
	let router = null;
	let transport = null;

	if (roomname) {
		const room = Room.getRoom(roomname);
		router = room.router;
		transport = await router.createWebRtcTransport(mediasoupOptions.webRtcTransport);
	}
	else {
		console.error('[createTransport] Room not found: ' + roomname);
		router = null;
		// router = defaultRoom.router;
	}
	//console.log('-- create transport room=%s id=%s', roomname, transport.id);

	return {
		transport: transport,
		params: {
			id: transport.id,
			iceParameters: transport.iceParameters,
			iceCandidates: transport.iceCandidates,
			dtlsParameters: transport.dtlsParameters
		}
	};
}


async function createConsumer(roomname, transport, producer, rtpCapabilities) {
	let router = null;

	if (roomname) {
		const room = Room.getRoom(roomname);
		router = room.router;
	}
	else {
		console.error('[createConsumer] Room not found: ' + roomname);
		// router = defaultRoom.router;
	}

	if (router){
		if (!router.canConsume(
			{
				producerId: producer.id,
				rtpCapabilities,
			})
		) {
			console.error('can not consume');
			return;
		}
	
		let consumer = null;
		//consumer = await producerTransport.consume({ // NG: try use same trasport as producer (for loopback)
		consumer = await transport.consume({ // OK
			producerId: producer.id,
			rtpCapabilities,
			paused: producer.kind === 'video',
		}).catch(err => {
			console.error('consume failed', err);
			return;
		});
		consumer.isTeacher = producer.isTeacher;
	
		//if (consumer.type === 'simulcast') {
		//  await consumer.setPreferredLayers({ spatialLayer: 2, temporalLayer: 2 });
		//}
	
		return {
			consumer: consumer,
			params: {
				producerId: producer.id,
				id: consumer.id,
				kind: consumer.kind,
				rtpParameters: consumer.rtpParameters,
				type: consumer.type,
				producerPaused: consumer.producerPaused,
				isTeacher: consumer.isTeacher
			}
		};
	} else {
		console.error('Could not create consumer.');
		return null;
	}

}



