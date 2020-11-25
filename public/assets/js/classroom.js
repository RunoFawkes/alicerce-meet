let localVideo;
let localControls;
let localContainer;
let localName;
let remoteContainer;
let teacherContainer;
let teacherControls;
let messageHistory;
let messageInput;
let assessmentIframe;

let audioTrack = null;
let videoTrack = null;

let clientId = null;
let device = null;

let producerTransport = null;
let videoProducer = null;
let audioProducer = null;

let consumerTransport = null;
let videoConsumers = {};
let audioConsumers = {};

let audioContext = null;
let audioFftArray = null;
let audioAnalysers = {};

let roomPath = null;
let currentRoom = 1;

let nickname = '';

let audioConstraints = null;
let videoConstraints = null;

let isConnected = false;
let isTeacher = false;
let isGhost = false;
let isScreensharing = false;
let videoOnScreenOff = false;

let audioEnabled = false;
let videoEnabled = false;

let audioBlocked = false;
let videoBlocked = false;
let audioOnUnblock = false;
let videoOnUnblock = false;

let teacherId = null;

let socket = null;

function sendRequest(type, data) {
	return new Promise((resolve, reject) => {
		// console.log(socket);
		socket.emit(type, data, (err, response) => {
			if (!err) {
				// Success response, so pass the mediasoup response to the local Room.
				resolve(response);
			} else {
				reject(err);
			}
		});
	});
}

function template(templateName, data) {
	let template = $('#templates').find(`[data-template='${templateName}']`);
	let html = template.prop('outerHTML');
	if (data) {
		for (let key in data) {
			if (data.hasOwnProperty(key)) {
				html = html.replace(new RegExp(`{{${key}}}`, 'g'), data[key]);
			}
		}
	}

	let output = $(html);
	output.removeAttr('data-template');
	return output;
}

function parseUrl() {
	const url = new URL(window.location.href);

	let pathname = window.location.pathname;
	let pathnameArray = pathname.split('/');

	let userType = pathnameArray[1];
	let roomId = pathnameArray[2];
	let studentUrl = `${window.location.protocol}//${window.location.hostname}/s/${roomId}`;

	roomPath = roomId;

	if (userType === 't') {
		isTeacher = true;
		$("#link_container").css("display", "block");
		$('#studentUrl').val(studentUrl);
	}

	let mode = url.searchParams.get('mode');
	let auth = url.searchParams.get('auth');
	if (mode === 'dev') {
		$('body').addClass('dev');
	} else if (mode === 'pedagogico' && auth === 'dsafhydrtd45'){
		isGhost = true;
		$("#local_video").css('display', 'none');
		$("#local_controls").css('display', 'none');
		$("#teacher_controls").css('display', 'none');
		$("#local_name").css('display', 'none');
	}

}


function consoleProxy(context, method, message) {
	return function () {
		let output = message;
		for (let i = 0; i < arguments.length; i++) {
			let value = arguments[i];
			let isObject = (typeof (value) === 'object' && value !== null);
			output += ` ${isObject ? value.toString() : value}`;
		}

		// sendeDevMessage(output);
		sendMessage('dev', output);
		method.apply(context, [message].concat(Array.prototype.slice.apply(arguments)));
	}
}

function initializeDevUtils() {
	console.error = consoleProxy(console, console.error, '[ERRO]');
	console.warn = consoleProxy(console, console.warn, '[AVISO]');

	window.onerror = async function (message, source, lineNumber, columnNumber, error) {
		// sendeDevMessage(`${message} at ${source}:${lineNumber}`);
		await sendMessage('dev', `${message} at ${source}:${lineNumber}`);
	};
}

function initializeAudioTools() {
	let audioContextType = (window.AudioContext || window.webkitAudioContext);
	if (audioContextType) {
		audioContext = new audioContextType();
		audioFftArray = new Float32Array(256);
		if (audioContext) {
			setInterval(watchAudioTracks, 100);
		}
	}
}

function initializeDeviceOptions() {
	let supports = navigator.mediaDevices.getSupportedConstraints();

	audioConstraints = {
		sampleSize: 4,
		channelCount: 2
	};

	videoConstraints = {
		width: { max: 320 },
		height: { max: 180 },
		frameRate: { max: 10 }
	};

	if (!supports['sampleSize']) {
		delete audioConstraints['sampleSize'];
	}

	if (!supports['channelCount']) {
		delete audioConstraints['channelCount'];
	}

	if (Object.entries(audioConstraints).length === 0) {
		audioConstraints = true;
	}

	if (!supports['width']) {
		delete videoConstraints['width'];
	}

	if (!supports['height']) {
		delete videoConstraints['height'];
	}

	if (!supports['frameRate']) {
		delete videoConstraints['frameRate'];
	}

	if (Object.entries(videoConstraints).length === 0) {
		videoConstraints = true;
	}

	// console.log(audioConstraints);
	// console.log(videoConstraints);
}

function watchAudioTracks() {
	for (id in audioAnalysers) {
		let analyser = audioAnalysers[id];
		analyser.getFloatFrequencyData(audioFftArray);

		let dBs = -Infinity;
		for (let i = 4, ii = audioFftArray.length; i < ii; i++) {
			if (audioFftArray[i] > dBs && audioFftArray[i] < 0) {
				dBs = audioFftArray[i];
			}
		};

		/*
		Original formula to convert from dBs to linear scale (0..1): 
		Math.pow(10, dBs / 20);
		Runo's version (exaggerated and normalized to ten levels): 
		Math.round(Math.pow(10, dBs / 85) * 10) * 10; //Multiples of 10
		Math.ceil(Math.round(Math.pow(10, dBs / 85) * 100) / 5) * 5; //Multiples of 5
		*/

		let volume = Math.round(Math.pow(10, dBs / 85) * 10) * 10;
		volume = (volume <= 10 ? 0 : volume); // Truncate 10% to 0%

		$(`#meter_${id}`).css('height', `${volume}%`);
	}
}

function createAudioAnalyser(id, stream) {
	if (audioContext) {
		let source = audioContext.createMediaStreamSource(stream);
		let analyser = audioContext.createAnalyser();
		analyser.smoothingTimeConstant = 0.1;
		analyser.fftSize = 512;

		source.connect(analyser);
		//analyser.connect(audioContext.destination); // Makes the context play sound

		audioAnalysers[id] = analyser;
		// console.log('Analyser created id=', id);
	}
}

function removeAudioAnalyser(id) {
	if (audioAnalysers[id]) {
		$(`#meter_${id}`).css('height', '0%');
		delete audioAnalysers[id];
		// console.log('Analyser removed id=', id);
	} else {
		// console.log('Analyser not there to remove id=', id);
	}
}

function initializeUI() {
	localContainer = $('#local_container');
	localControls = $('#local_controls');
	localName = $('#local_name');
	remoteContainer = $('#remote_container');
	teacherContainer = $('#teacher_container');
	teacherControls = $("#teacher_controls");
	localVideo = $('#local_container').find('video')[0];
	messageInput = $("#message_input");
	messageHistory = $("#messages");
	assessmentIframe = $('#assessment_iframe');

	messageInput.keypress(function (event) {
		if (event.which == 13) {
			event.preventDefault();
			sendMessage('normal');
		}
	});

	if (isTeacher) {
		teacherContainer.addClass('hidden');
		$('body').addClass('teacher');
	} else {
		teacherControls.addClass('hidden');
		$('body').addClass('student');
	}
}

function updateUI() {
	if (!audioEnabled) {
		$('#toggle_mute_self_button').removeClass('enabled');
	} else {
		$('#toggle_mute_self_button').addClass('enabled');
	}

	if (!videoEnabled) {
		$('#toggle_camera_self_button').removeClass('enabled');
	} else {
		$('#toggle_camera_self_button').addClass('enabled');
	}

	if (isScreensharing) {
		$('#share_screen_button').removeClass('enabled');
	} else {
		$('#share_screen_button').addClass('enabled');
	}

	if (audioBlocked) {
		$('#toggle_mute_self_button').addClass('disabled');
	} else {
		$('#toggle_mute_self_button').removeClass('disabled');
	}

	if (videoBlocked) {
		$('#toggle_camera_self_button').addClass('disabled');
		$('#share_screen_button').addClass('disabled');
	} else {
		$('#toggle_camera_self_button').removeClass('disabled');
		$('#share_screen_button').removeClass('disabled');
	}

	$('.tab-button').removeClass('active');
	$(`.tab-button[data-room="${currentRoom}"]`).addClass('active');
}

async function loadDevice(routerRtpCapabilities) {
	try {
		device = new MediasoupClient.Device();
	} catch (error) {
		if (error.name === 'UnsupportedError') {
			console.error('[loadDevice] esse navegador não é suportado');
		} else {
			console.error(error);
		}
	}

	await device.load({ routerRtpCapabilities });
}

function setupTransportListeners() {
	if (producerTransport) {
		producerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
			sendRequest('connectProducerTransport', { dtlsParameters: dtlsParameters })
				.then(callback)
				.catch(errback);
		});

		producerTransport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
			try {
				const { id } = await sendRequest('produce', {
					transportId: producerTransport.id,
					kind,
					rtpParameters
				});
				callback({ id });
				// console.log('--produce requested, then subscribe ---');
				// HERE MAJOR DOUBT -> should subscribe again/yet?
				// subscribe();
			} catch (err) {
				errback(err);
			}
		});

		producerTransport.on('connectionstatechange', (state) => {
			switch (state) {
				case 'connecting':
					// console.log('producerTransport connecting...');
					break;

				case 'connected':
					// console.log('producerTransport connected.');
					
					break;
				case 'failed':
					console.log('producerTransport connection failed.');
					producerTransport.close();
					break;

				default:
					break;
			}
		});
	} else {
		console.error('[setupTransportListeners] producerTransport não foi inicializado (a aplicação provavelmente vai travar)');
	}

	if (consumerTransport) {
		consumerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
			sendRequest('connectConsumerTransport', { dtlsParameters: dtlsParameters })
				.then(callback)
				.catch(errback);
		});

		consumerTransport.on('connectionstatechange', (state) => {
			switch (state) {
				case 'connecting':
					// console.log('consumerTransport connecting...');
					break;

				case 'connected':
					// console.log('consumerTransport connected.');
					break;

				case 'failed':
					console.log('consumerTransport connection failed.');
					consumerTransport.close();
					break;

				default:
					break;
			}
		});
	} else {
		console.error('[setupTransportListeners] consumerTransport não foi inicializado (a aplicação provavelmente vai travar)');
	}
}

async function enableLocalAudio() {
	if (!audioEnabled && !isGhost) {
		await enableLocalAudioTrack();
		await addTrack('local', audioTrack, 'audio');
		await startAudioProducer();
		audioEnabled = true;
		updateUI();
	}
}

async function disableLocalAudio() {
	if (audioEnabled && !isGhost) {
		await stopAudioProducer();
		removeTrack('local', 'audio');
		disableLocalAudioTrack();
		audioEnabled = false;
		updateUI();
	}
}

async function enableLocalVideo() {
	if (!videoEnabled && !isGhost) {
		await enableLocalVideoTrack();
		await addTrack('local', videoTrack, 'video');
		await startVideoProducer();
		videoEnabled = true;
		updateUI();
	}
}

async function disableLocalVideo() {
	if (videoEnabled && !isGhost) {
		await stopVideoProducer();
		removeTrack('local', 'video');
		disableLocalVideoTrack();
		isScreensharing = false;
		videoEnabled = false;
		updateUI();
	}
}

async function enableLocalAudioTrack() {
	if (!audioTrack) {
		let stream = null;

		try {
			// console.log(audioConstraints);
			// stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
			stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
			if (stream) {
				let tracks = stream.getAudioTracks();
				if (tracks && tracks.length) {
					audioTrack = tracks[0];

					for (let i = 1; i < tracks.length; i++) {
						tracks[i].stop();
						tracks[i] = null;
					}
					tracks = null;
					stream = null;
				}
			}
		} catch (error) {
			audioTrack = null;
			console.error(`[enableLocalAudioTrack] o microfone não pôde ser ativado. Mensagem de erro: ${error}`);
		}
	}
}

function disableLocalAudioTrack() {
	if (audioTrack) {
		audioTrack.stop();
		audioTrack = null;
	} else {
		console.warn('[disableLocalAudioTrack] audioTrack não existe (não deve causar nenhum problema)');
	}
}

async function enableLocalVideoTrack() {
	if (!videoTrack) {
		let stream = null;

		try {
			// console.log(videoConstraints);
			// stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints });
			stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
			if (stream) {
				let tracks = stream.getVideoTracks();
				if (tracks && tracks.length) {
					videoTrack = tracks[0];

					for (let i = 1; i < tracks.length; i++) {
						tracks[i].stop();
						tracks[i] = null;
					}
					tracks = null;
					stream = null;
				}
			}
		} catch (error) {
			videoTrack = null;
			console.error(`[enableLocalVideoTrack] a câmera não pôde ser ativada. Mensagem de erro: ${error}`);
		}
	}
}

function disableLocalVideoTrack() {
	if (videoTrack) {
		videoTrack.stop();
		videoTrack = null;
	} else {
		console.warn('[disableLocalVideoTrack] videoTrack não existe (não deve causar nenhum problema)');
	}
}

async function startAudioProducer() {
	if (!audioProducer && audioTrack) {
		try {
			audioProducer = await producerTransport.produce(
				{
					track: audioTrack,
					encodings: [
						{ maxBitrate: 7500 }
					]
				}
			);
			// console.log('Started audioProducer');
		} catch (error) {
			console.error(`[startAudioProducer] o áudio do microfone não pôde ser enviado ao servidor. Mensagem de erro: ${error}`);
		}
	}
}

async function stopAudioProducer() {
	if (audioProducer) {
		audioProducer.close();
		audioProducer = null;
		await sendRequest('stopAudioProducer', {});
		// console.log('Stopped audioProducer');
	}
}

async function startVideoProducer() {
	if (!videoProducer && videoTrack) {
		try {
			videoProducer = await producerTransport.produce(
				{
					track: videoTrack,
					encodings: [
						{ maxBitrate: 100000 }
					]
				}
			);
			// console.log('Started videoProducer');
		} catch (error) {
			console.error(`[startVideoProducer] o vídeo da câmera não pôde ser enviado ao servidor. Mensagem de erro: ${error}`);
		}
	}

}

async function stopVideoProducer() {
	if (videoProducer) {
		videoProducer.close();
		videoProducer = null;
		await sendRequest('stopVideoProducer', {});
		// console.log('Stopped videoProducer');
	}
}

async function addTrack(id, track, kind) {
	// console.log('Adding track:', kind);
	if (track) {
		let element = null;

		if (id === 'local') {
			element = localVideo;
		} else {
			let userFeed = $(`.user-feed[data-id="${id}"]`);
			if (userFeed.length) {
				element = userFeed.find('video')[0];
			} else {
				console.error(`[addTrack '${kind}'] usuário '${id}' inexistente (resultado imprevisível, usuário pode ter saído da sala?)`);
			}
		}

		if (element) {
			let stream;
			if (element.srcObject) {
				stream = element.srcObject;
				element.srcObject.addTrack(track);
			} else {
				stream = new MediaStream();
				stream.addTrack(track);
				element.srcObject = stream;

				try {

					await element.play();

					if (id !== 'local') {
						//video.volume = 1.0;
						//video.muted = false;
						$(element).removeAttr('muted');
						$(element).prop('muted', false);
					}

				} catch (error) {
					console.error(`[addTrack '${kind}'] erro na ação play() do usuário ${id} (esse usúario não emitirá som ou vídeo). Mensagem de erro: ${error}`);
				}
			}

			if (kind === 'video') {
				$(element).removeClass('hidden');
			} else if (kind === 'audio') {
				createAudioAnalyser(id, stream);
			}
		}
	}
}

function removeTrack(id, kind) {
	// console.log('Removing track:', kind);
	let element = null;

	if (id === 'local') {
		element = localVideo;
	} else {
		let userFeed = $(`.user-feed[data-id="${id}"]`);
		if (userFeed.length) {
			element = userFeed.find('video')[0];
		} else {
			console.error(`[removeTrack] usuário '${id}' inexistente (ação cancelada, usuário pode ter saído da sala?)`);
		}
	}

	if (element) {
		if (element.srcObject) {
			let elementTracks = null;
			if (kind === 'audio') {
				elementTracks = element.srcObject.getAudioTracks();
			} else if (kind === 'video') {
				elementTracks = element.srcObject.getVideoTracks();
			} else {
				console.error('removeTrack ERROR unknown KIND=', id);
			}

			if (elementTracks) {
				for(let i = 0; i < elementTracks.length; i++){
					element.srcObject.removeTrack(elementTracks[i]);
				}
			}

			if (!element.srcObject.getTracks().length) {
				$(element).attr('muted', '');
				$(element).prop('muted', true);
				element.pause();
				element.srcObject = null;
			}

		} else {
			// console.warn('removeTrack WARN element has no stream id=', id);
		}

		if (kind === 'video') {
			$(element).addClass('hidden');
		} else if (kind === 'audio') {
			removeAudioAnalyser(id);
		}
	}
}

async function addConsumer(transport, remoteSocketId, prdId, trackKind) {
	const { rtpCapabilities } = device;

	const data = await sendRequest('consumeAdd', { rtpCapabilities: rtpCapabilities, remoteId: remoteSocketId, kind: trackKind })
		.catch(error => {
			console.error(`[addConsumer] consumeAdd retornou um erro: ${error}`);
		});

	const {
		producerId,
		id,
		kind,
		rtpParameters,
		isTeacher
	} = data;

	if (prdId && (prdId !== producerId)) {
		console.warn('[addConsumer] producerId não bate, possível problema de sincronia com servidor (problemático, não deve acontecer)');
	}

	let codecOptions = {};
	const consumer = await transport.consume({
		id,
		producerId,
		kind,
		rtpParameters,
		codecOptions
	});

	if (kind === 'video') {
		videoConsumers[remoteSocketId] = consumer;
	} else if (kind === 'audio') {
		audioConsumers[remoteSocketId] = consumer;
	} else {
		console.error(`[addConsumer] tipo desconhecido: ${kind}. (erro crítico, resultado imprevisível)`);
	}

	consumer.remoteId = remoteSocketId;

	consumer.on("transportclose", () => {
		console.warn(`consumer.on("transportclose") ${consumer.remoteId}`);
		//removeConsumer(consumer.remoteId, kind);
	});

	consumer.on("producerclose", () => {
		console.warn(`consumer.on("producerclose") ${consumer.remoteId}`);
		//removeConsumer(consumer.remoteId, kind);
	});

	consumer.on('trackended', () => {
		console.warn(`consumer.on("trackended") ${consumer.remoteId}`);
		//removeConsumer(consumer.remoteId, kind);
	});

	if (kind === 'video') {
		// console.log('--try resumeAdd --');
		sendRequest('resumeAdd', { remoteId: remoteSocketId, kind: kind })
			.then(() => {
				// console.log('resumeAdd OK');
			})
			.catch(err => {
				console.error(`[addConsumer] erro na ação resumeAdd (usuário ficará sem vídeo)`);
			});
	}

	await addTrack(remoteSocketId, consumer.track, kind);
}

function removeConsumer(id, kind) {
	if (kind === 'video') {
		if (videoConsumers[id]) {
			videoConsumers[id].close();
			delete videoConsumers[id];
		} else {
			// console.log(videoConsumers);
			// console.warn(`[removeConsumer] consumer de ${kind} com id '${id}' não existe. (não deve causar problemas)`);
		}
		// console.log('videoConsumers count=' + Object.keys(videoConsumers).length);
	} else if (kind === 'audio') {
		if (audioConsumers[id]) {
			audioConsumers[id].close();
			delete audioConsumers[id];
		} else {
			// console.log(audioConsumers);
			// console.warn(`[removeConsumer] consumer de ${kind} com id '${id}' não existe. (não deve causar problemas)`);
		}
		// console.log('audioConsumers count=' + Object.keys(audioConsumers).length);
	} else {
		console.error(`[removeConsumer] tipo desconhecido: ${kind}. (erro crítico, resultado imprevisível)`);
	}

	removeTrack(id, kind);
}

function enableConsumerUI(id, kind) {
	let userFeed = $(`.user-feed[data-id="${id}"]`);
	let button = null;

	if (userFeed.length) {
		if (kind === 'audio') {
			button = userFeed.find('[data-button="mic"]');
		} else if (kind === 'video') {
			button = userFeed.find('[data-button="cam"]');
		} else {
			console.error(`[enableConsumerUI] tipo desconhecido: ${kind}. (erro crítico, resultado imprevisível)`);
		}
		button.addClass('enabled');
	} else {
		console.warn(`[enableConsumerUI] usuário '${id}' inexistente (ação cancelada, não deve causar problemas)`);
	}
}

function disableConsumerUI(id, kind) {
	let userFeed = $(`.user-feed[data-id="${id}"]`);
	let button = null;

	if (userFeed.length) {
		if (kind === 'audio') {
			button = userFeed.find('[data-button="mic"]');
		} else if (kind === 'video') {
			button = userFeed.find('[data-button="cam"]');
		} else {
			console.error(`ERROR: unknown kind='${kind}'`);
		}
		button.removeClass('enabled');
	} else {
		console.warn(`[disableConsumerUI] usuário '${id}' inexistente (ação cancelada, não deve causar problemas)`);
	}
}

function addUser(id, user) {
	if(!user.isGhost){
		let userFeedCheck = $(`.user-feed[data-id="${id}"]`);

		if (!userFeedCheck.length) {
			user.id = id;
			user.type = (user.isTeacher ? 'teacher' : 'student');
			user.audioEnabled = (user.audioEnabled ? 'enabled' : '');
			user.videoEnabled = (user.videoEnabled ? 'enabled' : '');
			user.audioBlocked = (user.audioBlocked ? 'blocked' : '');
			user.videoBlocked = (user.videoBlocked ? 'blocked' : '');
	
			userFeed = template('user-feed', user);
	
			if (user.isTeacher) {
				teacherContainer.append(userFeed);
			} else {
				remoteContainer.append(userFeed);
			}
		} else {
			console.warn(`[addUser] usuário '${id}' já existe (ação cancelada, problemático, não deveria acontecer)`);
		}
	}
}

function removeUser(id) {
	let userFeed = $(`.user-feed[data-id="${id}"]`);

	if (userFeed.length) {
		removeConsumer(id, 'audio'); // should be redundant, but isn't right now
		removeConsumer(id, 'video'); // should be redundant, but isn't right now

		let videoElement = userFeed.find('video')[0];
		if (videoElement) {
			videoElement.pause();
			videoElement.srcObject = null;
		} else {
			console.warn(`[removeUser] o elemento <video> para o id '${id}' não existe (ação cancelada, não deve causar problemas)`);
		}
		userFeed.remove();
	} else {
		console.warn(`[removeUser] o usuário com id '${id}' não existe (ação cancelada, não deve causar problemas)`);
	}
}

function userExists(id) {
	return ($(`.user-feed[data-id="${id}"]`).length > 0);
}

function blockUserProducer(id, kind) {
	let userFeed = $(`.user-feed[data-id="${id}"]`);
	let button = null;

	if (userFeed.length) {
		if (kind === 'audio') {
			button = userFeed.find('.button-icon[data-button="mic"]');
		} else if (kind === 'video') {
			button = userFeed.find('.button-icon[data-button="cam"]');
		} else {
			console.error(`[blockUserProducer] tipo desconhecido: ${kind}. (erro crítico, resultado imprevisível)`);
		}

		if (button) {
			button.addClass('blocked');
		}
	} else {
		console.warn(`[blockUserProducer] o usuário com id '${id}' não existe (ação cancelada, não deve causar problemas)`);
	}
}

function unblockUserProducer(id, kind) {
	let userFeed = $(`.user-feed[data-id="${id}"]`);
	let button = null;

	if (userFeed.length) {
		if (kind === 'audio') {
			button = userFeed.find('.button-icon[data-button="mic"]');
		} else if (kind === 'video') {
			button = userFeed.find('.button-icon[data-button="cam"]');
		} else {
			console.error(`[unblockUserProducer] tipo desconhecido: ${kind}. (erro crítico, resultado imprevisível)`);
		}

		if (button) {
			button.removeClass('blocked');
		}
	} else {
		console.warn(`[unblockUserProducer] o usuário com id '${id}' não existe (ação cancelada, não deve causar problemas)`);
	}
}

function removeAllUsers() {
	$('.user-feed').not('[data-template="user-feed"]').each((index, object) => {
		let userFeed = $(object);

		if (!userFeed.hasClass('local')) {
			let videoElement = userFeed.find('video')[0];

			if (videoElement) {
				videoElement.pause();
				videoElement.srcObject = null;
			} else {
				console.warn(`[removeAllUsers] o elemento <video> para o id '${id}' não existe (ação cancelada, não deve causar problemas)`);
			}
			userFeed.remove();
		}
	});
}

function addMessage(messageData) {
	if (messageData.type === 'assessment') {
		let link = messageData.message;
		teacherId = messageData.id;
		messageData.message = template('assessment-link', { link: link }).html();
	} else {
		let originalMessage = messageData.message;
		let parsePackage = {
			input: originalMessage,
			options: {
				attributes: {
					target: "_blank",
					class: "chat-link",
				},
				specialTransform: [
					{
						test: /.*\.(png|jpg|jpeg|svg|apng|avif|jfif|pjpeg|pjp|gif|webp)$/,
						transform: (src) => {
							return `<a href="${src}" target="_blank" class='chat-image-link'><img src="${src}"></a>`;
						}
					}
				]
			}
		};

		messageData.message = anchorme(parsePackage);
	}

	let message = template('user-message', messageData);
	messageHistory.append(message);
	messageHistory.scrollTop(messageHistory[0].scrollHeight - messageHistory[0].clientHeight);
}

function removeAllMessages() {
	messageHistory.empty();
}

function connectSocket() {
	return new Promise((resolve, reject) => {
		socket = io.connect('/', {reconnection: false});

		socket.on('connect', async function (evt) {
			// console.log('Starting handshake');
			await sendRequest('join_room', { roomId: (roomPath + '-' + currentRoom) });
			let user = await sendRequest('register', { isTeacher: isTeacher, nickname: nickname, isGhost: isGhost });

			if (user) {
				localName.html(user.nickname);
				localName.css('background-color', user.color);
			} else {
				console.error('[connectSocket] [connect] a inicialização do usuário no servidor falhou (a aplicação provavelmente vai travar)');
			}
		});

		socket.on('message', function (message) {
			if (message.type === 'welcome') {
				if (socket.id !== message.id) {
					console.warn(`[connectSocket] [message] socket.id '${socket.id}' não bate com message.id '${message.id}' (problemático, não deve acontecer)`);
				}

				clientId = message.id;
				resolve();
			} else {
				console.error(`[connectSocket] [message] o servidor enviou uma mensagem inesperada durante o handshake: '${message}' (a aplicação provavelmente vai travar)`);
				reject(message);
			}
		});

		socket.on('error', function (error) {
			console.error(`[connectSocket] [error] socket.io falhou com a mensagem: ${error}`);
			reject(error);
		});

		socket.on('disconnect', async function (evt) {
			//splashScreen('disconnect');
		});

		socket.on('newUser', function (message) {
			const remoteId = message.socketId;
			const user = message.user;

			// console.log('--try addUser remoteId=' + remoteId);
			addUser(remoteId, user);
		});

		socket.on('userClosed', function (message) {
			const remoteId = message.socketId;

			// console.log('--try removeUser remoteId=' + remoteId);
			removeUser(remoteId);
		});

		socket.on('newProducer', function (message) {
			const remoteId = message.socketId;
			const prdId = message.producerId;
			const kind = message.kind;

			// console.log('--try consumeAdd remoteId=' + remoteId + ', prdId=' + prdId + ', kind=' + kind);
			if (userExists(remoteId)) {
				enableConsumerUI(remoteId, kind);
				addConsumer(consumerTransport, remoteId, prdId, kind);
			} else {
				console.error(`[connectSocket] [newProducer] usuário com id '${remoteId}' inexistente (ação cancelada, não deve causar problemas)`);
			}
		});

		socket.on('producerClosed', function (message) {
			const localId = message.localId;
			const remoteId = message.remoteId;
			const kind = message.kind;

			if (userExists(remoteId)){
				disableConsumerUI(remoteId, kind);
				removeConsumer(remoteId, kind);
			}
		});

		socket.on('producerBlocked', async function (message) {
			const remoteId = message.remoteId;
			const kind = message.kind;
			// console.log('Asked to block', remoteId);
			// console.log('I am', clientId);

			if (remoteId === clientId) {
				if (kind === 'audio') {
					if (audioEnabled) {
						await disableLocalAudio();
						audioOnUnblock = true;
					} else {
						audioOnUnblock = false;
					}
					audioBlocked = true;
				} else if (kind === 'video') {
					if (videoEnabled) {
						await disableLocalVideo();
						videoOnUnblock = true;
					} else {
						videoOnUnblock = false;
					}
					videoBlocked = true;
				} else {
					console.error(`[connectSocket] [producerBlocked] tipo desconhecido: ${kind}. (erro crítico, resultado imprevisível)`);
				}
				updateUI();
			} else {
				blockUserProducer(remoteId, kind);
			}
		});

		socket.on('producerUnblocked', async function (message) {
			const remoteId = message.remoteId;
			const kind = message.kind;
			// console.log('Asked to unblock', remoteId);
			// console.log('I am', clientId);

			if (remoteId === clientId) {
				if (kind === 'audio') {
					audioBlocked = false;
					if (audioOnUnblock) {
						await enableLocalAudio();
						audioOnUnblock = false;
					}
				} else if (kind === 'video') {
					videoBlocked = false;
					if (videoOnUnblock) {
						await enableLocalVideo();
						videoOnUnblock = false;
					}
				} else {
					console.error(`[connectSocket] [producerUnblocked] tipo desconhecido: ${kind}. (erro crítico, resultado imprevisível)`);
				}
				updateUI();
			} else {
				unblockUserProducer(remoteId, kind);
			}
		});

		socket.on('receiveMessage', function (data) {
			addMessage(data);
		});

		/*
		socket.on('receiveAssessmentLink', async function (link) {
			let message = template('assessment-link', { link: link });
			messageHistory.append(message);
			messageHistory.scrollTop(messageHistory[0].scrollHeight - messageHistory[0].clientHeight);
		});
		*/

	});
}

function disconnectSocket() {
	if (socket) {
		socket.close();
		socket = null;
		clientId = null;
		// console.log('socket.io disconnected.');
	}
}

async function connect() {
	if (!isConnected) {
		console.log('Starting connection...');

		try {
			await connectSocket();
		} catch (error) {
			console.error('[connect] Conexão via socket falhou (conexão abortada)');
			console.error(error);
			return;
		}

		const data = await sendRequest('getRouterRtpCapabilities', {});
		await loadDevice(data);

		if (!producerTransport) {
			const params = await sendRequest('createProducerTransport', {});
			producerTransport = device.createSendTransport(params);
		}

		if (!consumerTransport) {
			const params = await sendRequest('createConsumerTransport', {});
			consumerTransport = device.createRecvTransport(params);
		}

		setupTransportListeners();

		let currentInfo;
		try {
			currentInfo = await sendRequest('getCurrentRemoteInfo', { localId: clientId });

			currentInfo.remoteUsers.forEach(user => {
				addUser(user.id, user);
			});

			currentInfo.remoteVideoIds.forEach(rId => {
				addConsumer(consumerTransport, rId, null, 'video');
			});

			currentInfo.remoteAudioIds.forEach(rId => {
				addConsumer(consumerTransport, rId, null, 'audio');
			});
		} catch (error) {
			console.error(`[connect] [getCurrentRemoteInfo] mensagem de erro: ${error}`);
		}

		let chatHistory;
		try {
			chatHistory = await sendRequest('getChatHistory', {});

			chatHistory.messages.forEach(message => {
				addMessage(message);
			});
		} catch (error) {
			console.error(`[connect] [getChatHistory] mensagem de erro: ${error}`);
		}

		isConnected = true;
		updateUI();
		console.log('Connection estabilished.');
	}
}

async function disconnect() {
	if (isConnected) {
		await disableLocalAudio();
		await disableLocalVideo();

		if (producerTransport) {
			producerTransport.close();
			producerTransport = null;
		}

		for (const key in videoConsumers) {
			const consumer = videoConsumers[key];
			consumer.close();
			delete videoConsumers[key];
		}

		for (const key in audioConsumers) {
			const consumer = audioConsumers[key];
			consumer.close();
			delete audioConsumers[key];
		}

		if (consumerTransport) {
			consumerTransport.close();
			consumerTransport = null;
		}

		removeAllUsers();
		removeAllMessages();
		disconnectSocket();

		isConnected = false;
		updateUI();
		console.log('Connection ended.');
	}
}

async function micToggleSelf() {
	if (!audioBlocked) {
		localControls.addClass('working');
		if (audioEnabled) {
			await disableLocalAudio();
		} else {
			await enableLocalAudio();
		}
		localControls.removeClass('working');
		updateUI();
	}
}

async function cameraToggleSelf() {
	if (!videoBlocked) {
		localControls.addClass('working');
		if (videoEnabled) {
			await disableLocalVideo();
		} else {
			await enableLocalVideo();
		}
		localControls.removeClass('working');
		updateUI();
	}
}

async function screenshare(forceDisable) {
	if (!videoBlocked) {
		localControls.addClass('working');
		if (isScreensharing || forceDisable) {
			await disableLocalVideo();
			if (videoOnScreenOff) {
				await enableLocalVideo();
			} else {
				videoEnabled = false;
			}
			videoOnScreenOff = false;
			isScreensharing = false;
		} else {

			if (videoEnabled) {
				videoOnScreenOff = true;
			}

			let screenVideoTrack = null;
			// let screenAudioTrack = null;
			try {
				let stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
				screenVideoTrack = stream.getVideoTracks()[0];
				/*
				screenAudioTrack = stream.getAudioTracks();
				console.log(screenVideoTrack);
				console.log(screenAudioTrack);
				*/
			} catch (error) {
				console.error(`[screenshare] falha ao capturar tela (captura cancelada). Mensagem de erro: ${error}`);
			}

			if (screenVideoTrack) {

				if (videoProducer) {
					await stopVideoProducer();
				}
				videoProducer = await producerTransport.produce(
					{
						track: screenVideoTrack,
						encodings: [
							{ maxBitrate: 1000000 }
						]
					}
				);

				removeTrack('local', 'video');
				await addTrack('local', screenVideoTrack, 'video');
				videoTrack = screenVideoTrack;

				videoEnabled = true;
				isScreensharing = true;

				screenVideoTrack.onended = () => {
					screenshare(true);
				};
			}

		}
		localControls.removeClass('working');
		updateUI();
	}
}

function fullscreen(id) {
	const userFeed = $(`.user-feed[data-id="${id}"]`);
	const video = userFeed.find('video');

	let fullscreenElement = userFeed[0];

	let isFullScreen = function () {
		return !!(document.fullscreen || document.webkitIsFullScreen || document.mozFullScreen || document.msFullscreenElement || document.fullscreenElement);
	}

	if (isFullScreen()) {
		if (document.exitFullscreen) {
			document.exitFullscreen();
		} else if (document.mozCancelFullScreen) {
			document.mozCancelFullScreen();
		} else if (document.webkitCancelFullScreen) {
			document.webkitCancelFullScreen();
		} else if (document.msExitFullscreen) {
			document.msExitFullscreen();
		}
	} else {
		if (fullscreenElement.requestFullscreen) {
			fullscreenElement.requestFullscreen();
		} else if (fullscreenElement.mozRequestFullScreen) {
			fullscreenElement.mozRequestFullScreen();
		} else if (fullscreenElement.webkitRequestFullScreen) {
			fullscreenElement.webkitRequestFullScreen();
		} else if (fullscreenElement.msRequestFullscreen) {
			fullscreenElement.msRequestFullscreen();
		}
	}

	if (isFullScreen()) {
		userFeed.removeClass('fullscreen');
	} else {
		userFeed.addClass('fullscreen');
	}

	fullscreenElement.addEventListener('fullscreenchange', (event) => {
		if (!document.fullscreenElement) {
			userFeed.removeClass('fullscreen');
		}
	});
}

async function exit() {
	splashScreen('loading');
	await disconnect();
	splashScreen('exit');
}

async function micToggleRemote(id) {
	if (isTeacher) {
		await sendRequest('toggleBlockAudio', { id: id });
	}
}

async function cameraToggleRemote(id) {
	if (isTeacher) {
		await sendRequest('toggleBlockVideo', { id: id });
	}
}

async function goToRoom(roomNumber) {
	if (currentRoom !== roomNumber) {
		currentRoom = roomNumber;
		splashScreen('loading');
		await disconnect();
		await connect();
		await sendDeviceInformation();
		await enableLocalAudio();
		splashScreen('none');
	}
}

async function sendMessage(type, message, id) {
	if (!message) {
		message = $.trim(messageInput.val());
	}

	if (message && isConnected) {
		if (type === 'normal') {
			messageInput.val('');
		}
		await sendRequest('chatMessage', { id: id, type: type, message: message });
	}
}

async function sendAssessment(id, nickname) {
	if (isTeacher) {
		let link = prompt(`Digite o link a ser enviado para ${nickname}:`);
		if (link) {
			await sendMessage('assessment', link, id);
			const selfLog = {
				id: 'system',
				name: 'Sistema',
				color: 'red',
				type: 'system',
				message: `O <div class="tooltip">LINK <span class="tooltip-content">${link}</span></div> foi enviado para ${nickname}.`
			};
			addMessage(selfLog);
		}
	}
}

async function launchAssessment(link) {
	let currentSrc = assessmentIframe.attr('src');
	if (!currentSrc) {
		assessmentIframe.attr('src', link);

		window.onbeforeunload = () => {
			return true;
		};
	}
	await splashScreen('assessment');
	splashScreen('none');
}

async function sendDeviceInformation() {
	let versionLog = '';
	versionLog += '<b>name: </b>' + platform.name + '<br>';
	versionLog += '<b>version: </b>' + platform.version + '<br>';
	versionLog += '<b>product: </b>' + platform.product + '<br>';
	versionLog += '<b>manufacturer: </b>' + platform.manufacturer + '<br>';
	versionLog += '<b>layout: </b>' + platform.layout + '<br>';
	versionLog += '<b>os: </b>' + platform.os + '<br>';
	versionLog += '<b>description: </b>' + platform.description + '<br>';

	// await sendDevMessage(versionLog);
	await sendMessage('dev', versionLog);
}

const stages = {
	none: (interface, resolve, reject) => {
		interface.splashScreen.removeClass('active');
		interface.splashScreen.attr('data-stage', '');
		resolve();
	},


	disconnect: (interface, resolve, reject) => {
		let button = interface.stage.find('#reload_page_button');

		button.on('click', (event) => {
			window.location.reload();
			button.off();
			resolve();
		});
	},

	assessment: (interface, resolve, reject) => {
		let button = interface.stage.find('#close_asessment_button');

		button.on('click', (event) => {
			console.log('click');
			button.off();
			resolve();
		});
	},

	preroom: (interface, resolve, reject) => {
		let button = interface.stage.find('#confirm_eula_button');
		let nameField = interface.stage.find('#name_input');
		let validation = interface.stage.find('.validation');

		let savedNickname = localStorage.getItem('nickname');
		nameField.val(savedNickname);

		button.on('click', (event) => {
			let typedNickname = $.trim(nameField.val());
			if (typedNickname) {
				validation.html('');
				localStorage.setItem('nickname', typedNickname);
				nickname = typedNickname;
				button.off();
				resolve();
			} else {
				validation.html('Você precisa digitar um nome para entrar!');
			}
		});
	}
};

function splashScreen(stageName) {
	let interface = {
		splashScreen: $('#splash_screen'),
		allStages: $('#splash_screen .stage'),
		stage: $(`#splash_screen .stage[data-stage='${stageName}']`)
	};

	interface.splashScreen.addClass('active');
	interface.splashScreen.attr('data-stage', stageName);
	interface.allStages.removeClass('active');
	interface.stage.addClass('active');

	if (stages[stageName]) {
		return new Promise((resolve, reject) => {
			stages[stageName](interface, resolve, reject);
		});
	}
}



async function init() {
	parseUrl();
	initializeUI();
	await splashScreen('preroom');

	splashScreen('initializing');
	initializeAudioTools();
	initializeDeviceOptions();
	initializeDevUtils();
	await connect();
	await sendDeviceInformation();
	await enableLocalAudio();
	splashScreen('none');
	
	window.onmessage = function(event){
		let message = event.data;
		if(message.split){
			let infoArray = message.split("_");
			let eventType = infoArray[0];
			let eventName = infoArray[1];
			let eventMessage = infoArray[2];

			console.log(infoArray);

			if(teacherId){
				sendMessage('system', `[${nickname}] ${eventMessage}`, teacherId);
			} 
		}
	};
}

$(document).ready(init);


/*
if(/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)){
  document.write("mobile");
}else{
  document.write("not mobile");
}
*/
