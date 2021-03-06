const Jaxcore = require('jaxcore');
const choose = require('./choose');

class Application extends Jaxcore.Adapter {
	constructor() {
		super(...arguments);
		
		this.choose = choose.bind(this);
		
		const bumblebee = this.services.bumblebee;
		
		this._isLoopActive = false;
		this._exiting = false;
		
		const looper = async (arg) => {
			let loopReturn = await this.loop(arg);
			if (loopReturn === false) {
				return loopReturn;
			}
			else if (this._didAbortReturn) {
				return this._didAbortReturn.returnValue;
			}
			else {
				return looper(loopReturn);
			}
		}
		
		this.addEvents(bumblebee, {
			applicationAutostart: function (id, initialArgs) {
				console.log('assistant received application-autostart', id, initialArgs)
				const go = () => {
					console.log('go()');
					console.log('this.emit(\'application-autostart\'', id, initialArgs);
					this.emit('application-autostart', id, initialArgs);
				};
				if (this._isLoopActive) {
					console.log('wait 0');
					go();
				}
				else {
					console.log('wait loop-started');
					this.once('loop-started', () => {
						console.log('loop-started go() ?');
						// go();
						this.emit('loop-wait', id, initialArgs);
					});
					// setTimeout(go, 5000);
				}
			},
			applicationRemoved: function (id, options) {
				if (typeof this.onApplicationRemoved === 'function') {
					this.onApplicationRemoved(id, options);
				}
			},
			applicationAdded: function (id, options) {
				console.log('applicationAdded', id, options);
				if (typeof this.onApplicationAdded === 'function') {
					this.onApplicationAdded(id, options);
				}
			},
			start: function (args) {
				if (this._isLoopActive) {
					console.log('this._isLoopActive, returrning');
					return false;
				}
				this._isStarted = true;
				
				
				this.log('start() onBegin');
				this.onBegin(args)
				.then(startReturn => {
					if (startReturn === false) {
						console.log('main returned', startReturn);
						return startReturn;
					}
					else if (this.loop) {
						this._isLoopActive = true;
						this.log('start() loop');
						this.emit('loop-started');
						this.services.bumblebee._applicationBegun(this); //this.socket.emit('application-begun');
						return looper(startReturn);
					}
					else return false;
				})
				.then(loopReturn => {
					this._isStarted = false;
					this._isLoopActive = false;
					delete this._didAbortReturn;
					if (this.onEnd) {
						this.onEnd(null, loopReturn).then(() => {
							bumblebee.returnValue(loopReturn);
						});
					}
					else {
						bumblebee.returnValue(loopReturn);
					}
				})
				.catch(e => {
					this._isStarted = false;
					this._isLoopActive = false;
					
					if (typeof e === 'object' && e._appAutoStart === true) {
						console.log('restarting loop, emit start');
						bumblebee.emit('start', args);
					}
					else if (e.aborted) {
						if (e.aborted === 'abort-return') {
							if (this.onEnd) {
								this.onEnd(null, e.returnValue).then(() => {
									bumblebee.returnValue(e.returnValue);
								});
							}
							else {
								bumblebee.returnValue(e.returnValue);
							}
						}
						if (e.aborted === 'abort-error') {
							if (this.onEnd) {
								this.onEnd(e.errorValue).then(() => {
									bumblebee.returnError(e.errorValue);
								});
							}
							else {
								bumblebee.returnError(e.errorValue);
							}
						}
						this._exiting = false;
					}
					else {
						console.log('main error', e);
						if (this.onEnd) {
							this.onEnd(e).then(() => {
								bumblebee.returnError(e);
							});
						}
						else {
							bumblebee.returnError(e);
						}
					}
					
				});
			},
		});
		
		this.on('teardown', function() {
			// todo: not working
			console.log('teardown')
			process.exit();
		});
		
	}
	
	// onBegin is intended to be overwritten
	async onBegin() {
	}
	
	// onEnd is intended to be overwritten
	async onEnd() {
	}
	
	return(r) {
		this._didAbortReturn = {
			returnValue: r
		};
	}
	
	async abort(e) {
		this.emit('abort-recognize', 'abort-error', e, null);
	}
	
	async run(appId, args, options) {
		return this.services.bumblebee.runApplication(appId, args, options);
	}
	
	lastRecognition() {
		return this._last_recognition;
	}
	
	async recognize(options) {
		this.log('recognize()', options);
		const bumblebee = this.services.bumblebee;
		if (!options) options = {};
		return new Promise((resolve, reject) => {
			let timedOut = false;
			let timer;
			
			const onTimedRecognize = (recognition) => {
				this._last_recognition = recognition;
				this.log('onTimedRecognize', recognition);
				removeEvents();
				clearTimeout(timer);
				if (timedOut) {
					this.log('onTimedRecognize too late', recognition);
				}
				else {
					resolve(recognition);
				}
			}
			
			const onRecognized = (recognition) => {
				this._last_recognition = recognition;
				this.log('onRecognized', recognition);
				removeEvents();
				clearTimeout(timer);
				resolve(recognition);
			};
			
			// assistant
			const autoStartHandler = (appId, initialArgs) => {
				console.log('on autoStartHandler', appId, initialArgs);
				removeEvents();
				clearTimeout(timer);
				debugger;
				this.run(appId, initialArgs)
				.then(r => {
					console.log('autoStartHandler return', r);
					reject({
						_appAutoStart: true
					});
				})
				.catch(e => {
					console.log('autoStartHandler catch', e);
					debugger;
					if (e === 'app disconnected') {
						console.log('CAUGHT app disconnected throw _appAutoStart', e);
						reject({
							_appAutoStart: true
						});
					}
					else {
						reject(e);
					}
				});
			};
			
			const removeEvents = () => {
				if (options.timeout) {
					bumblebee.removeListener('recognize', onTimedRecognize);
				}
				else {
					bumblebee.removeListener('recognize', onRecognized);
				}
				this.removeListener('abort-recognize', abortHandler);
				this.removeListener('application-autostart', autoStartHandler);
			}
			
			const abortHandler = (reason, errorValue, returnValue) => {
				removeEvents();
				clearTimeout(timer);
				reject({
					aborted: reason,
					errorValue,
					returnValue
				});
			};
			
			this.once('application-autostart', autoStartHandler);
			
			this.once('loop-wait', (id, initialArgs) => {
				console.log('loop wait !! autoStartHandler()s')
				autoStartHandler(id, initialArgs);
			});
			
			this.once('abort-recognize', abortHandler);
			
			if (options.timeout) {
				timer = setTimeout(function () {
					timedOut = true;
					removeEvents();
					reject({
						error: {
							timedOut: true
						}
					});
				}, options.timeout);
				
				bumblebee.once('recognize', onTimedRecognize);
			}
			else {
				bumblebee.once('recognize', onRecognized);
			}
		});
	}
	
	console(data) {
		this.services.bumblebee._console(data);
	}
	
	async playSound(name, theme, onBegin) {
		console.log('play sound', name);
		return this.services.bumblebee._playSound(name, theme, onBegin);
	}
	
	async delay(delayTime, resolveValue) {
		return this.services.bumblebee._delay(delayTime, resolveValue);
	}
	
	async say(text, options) {
		if (!options) options = {};
		if (!options.profile && this._defaultSayProfile) options.profile = this._defaultSayProfile;
		return this.services.bumblebee._say(text, options);
	}
	
	setSayProfile(name) {
		this._defaultSayProfile = name;
	}
	
	async systemRequest() {
		const args = Array.from(arguments);
		const dataId = args.shift();
		return this.services.bumblebee._systemRequest(dataId, args);
	}
	
	async confirm(text, options) {
		if (!options) options = {};
		options.style = 'yes_or_no';
		if (!'timeout' in options) options.timeout = 25000;
		let choice = await this.choose(text, [
			{
				text: 'Yes',
				matches: ['okay', 'yeah', 'yup', 'alright', 'affirmative']
			},
			{
				text: 'No',
				matches: ['nope', 'negative']
			}
		], options);
		return choice.index === 0;
	}
}

module.exports = Application;