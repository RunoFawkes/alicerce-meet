import { none } from './screens/none.js';

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

class ScreenManager {
	constructor(){

	}
}



async function init() {
	let manager = new ScreenManager();


	await splashScreen('preroom');
	await splashScreen('room');
}

$(document).ready(init);