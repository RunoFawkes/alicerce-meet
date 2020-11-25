$( document ).ready(() => {


    $('#create').on('click', () => {
		let request = {
			method: "GET",
			url: '/create'
		};
		let result = $.ajax(request);
	
		result.done(function (response) {
			let url = `${window.location.protocol}//${window.location.hostname}/t/${response}`;
			$("#message").html('Loading...');
			window.location.href = url;
		});
	
		result.fail(function (jqXHR, textStatus) {
            console.log('ERRO');
		});
    });

});