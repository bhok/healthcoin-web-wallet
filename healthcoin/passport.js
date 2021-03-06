var LocalStrategy = require('passport-local').Strategy;
var FacebookStrategy = require('passport-facebook').Strategy;
var GoogleStrategy = require('passport-google-oauth').OAuth2Strategy;
var TwitterStrategy = require('passport-twitter').Strategy;

var HCN = require('../app.js');
var User       = require('./user');
var configAuth = require('./auth')(HCN.appHost);
var bcrypt = require("bcryptjs");
var validator = require('validator');

module.exports = function(passport) {

	passport.serializeUser(function(user, done){
		done(null, user.id);
	});

	passport.deserializeUser(function(id, done){
		User.findById(id, function(err, user){
			done(err, user);
		});
	});

	passport.use('local-signup', new LocalStrategy({
		usernameField: 'email',
		passwordField: 'password',
		passReqToCallback: true
	},
	function(req, email, password, done){
		var name = req.body.name;
		var passwordRepeat = req.body.passwordRepeat;

		if (validator.isEmpty(name) || !validator.isAscii(name)){
			return done(null, false, req.flash('signupMessage', 'Name is not valid. Please try again.'));
		}
		if (!validator.isEmail(email)){
			return done(null, false, req.flash('signupMessage', 'That does not appear to be a valid email address.'));
		}
		if (!validator.isByteLength(password, {min:8, max:255})){
			return done(null, false, req.flash('signupMessage', 'The password should be at least 8 alpha-numeric characters.'));
		}
		if (validator.isAlpha(password)){ // Numbers required
			return done(null, false, req.flash('signupMessage', 'The password should contain numbers and special characters.'));
		}
		if (password !== passwordRepeat){
			return done(null, false, req.flash('signupMessage', 'The passwords do not match.'));
		}
		email = validator.normalizeEmail(email);

		var account = email, address = "", new_address = false;
		HCN.Api.exec('getaccountaddress', account, function(err, res){
			address = res;
			if (address === ""){
				// TODO: Future, use makekeypair and assign address to account
				HCN.Api.exec('getnewaddress', account, function(err, res){
					address = res;
					new_address = true;
					});
			}
		});

        setTimeout(function(){
		process.nextTick(function(){
			if (!address || address === ""){
				return done(null, false, req.flash('signupMessage', 'There was an error creating your account. Please try again later.'));
			}
			User.findOne({'local.id': email}, function(err, user){
				if(err)
					return done(err);
				if(user){
					// If we created a new address. Capture it.
					if (new_address){
						user.wallet.push( { node_id: HCN.Api.get('host'), account: account, address: address });
						// sendfrom <fromaccount> <tohealthcoinaddress> <amount> [minconf=1] [comment] [comment-to] [txcomment]
						HCN.Api.exec('sendfrom', HCN.MasterAccount, address, HCN.NewUserAmount, 1, "New Account", address, "Welcome to Healthcoin!", function(err, res){
							if (err) console.log("Error: err:" + err + " res:" + res);
							});
					}

					// Record last login
					user.profile.login_type = "local";
					user.profile.last_login = Date.now();
					user.save(function(err){
						if(err)
							throw err;
					});
					// Set globally
					HCN.User = user;
					return done(null, false, req.flash('signupMessage', 'You already have an account. Please login, instead.'));
				} else {
					var newUser = new User();
					newUser.local.id = email;
					newUser.local.password = newUser.local.generateHash(password);
					newUser.local.changeme = false;
					newUser.profile.login_type = "local";
					newUser.profile.last_login = Date.now();
					newUser.profile.role = "User";
					newUser.profile.name = name;
					newUser.profile.email = email;
					newUser.profile.description = "";
					newUser.profile.age = "";
					newUser.profile.weight = "";
					newUser.profile.waist = "";
					newUser.profile.gender = "";
					newUser.profile.ethnicity = "";
					newUser.profile.country = "";
                    newUser.profile.credit = 0;
					newUser.wallet.push( { node_id: HCN.Api.get('host'), account: account, address: address });

					newUser.save(function(err){
						if(err)
							throw err;
					});

					// Set globally
					HCN.User = newUser;
					// sendfrom <fromaccount> <tohealthcoinaddress> <amount> [minconf=1] [comment] [comment-to] [txcomment]
					HCN.Api.exec('sendfrom', HCN.MasterAccount, address, HCN.NewUserAmount, 1, "New Account", address, "Welcome to Healthcoin!", function(err, res){
						if (err) console.log("Error: err:" + err + " res:" + res);
						});
					return done(null, newUser);
				}
			});
		});
        },1000); // end timeout
	}));

	passport.use('local-login', new LocalStrategy({
			usernameField: 'email',
			passwordField: 'password',
			passReqToCallback: true
		},
		function(req, email, password, done){
			// Allow for non-email logins (ie. MasterAccount)
			if (validator.isEmail(email))
				email = validator.normalizeEmail(email);
			process.nextTick(function(){
				User.findOne({ 'local.id': email}, function(err, user){
					if(err)
						return done(err);
					if(!user)
						return done(null, false, req.flash('loginMessage', 'No user account found.'));
					if(!user.validPassword(password)){
						return done(null, false, req.flash('loginMessage', 'Invalid password.'));
					}

					var account = email, address = "", new_address = true;
					// If user.wallet does not have this node, create new wallet node_id/account/address.
					user.wallet.filter(function(wal){
						if(wal.node_id === HCN.Api.get('host')){
							new_address = false; // Found one
						}
					});
					if (new_address){
						// TODO: Future, use makekeypair and assign address to account
						HCN.Api.exec('getnewaddress', account, function(err, res){
							address = res;
							// push new wallet node/account/address
							user.wallet.push( { node_id: HCN.Api.get('host'), account: account, address: address });
							});
					}

					// This only ocurrs w/ MasterAccount
					if(password === 'password'){
						user.local.changeme = true;
					}

					setTimeout(function(){
						if (new_address){
							// sendfrom <fromaccount> <tohealthcoinaddress> <amount> [minconf=1] [comment] [comment-to] [txcomment]
							HCN.Api.exec('sendfrom', HCN.MasterAccount, address, HCN.NewUserAmount, 1, "New Account", address, "Welcome to Healthcoin!", function(err, res){
								if (err) console.log("Error: err:" + err + " res:" + res);
								});
						}

						// Record last login
						user.profile.login_type = "local";
						user.profile.last_login = Date.now();
						user.save(function(err){
							if(err)
								throw err;
						});
						// Set globally
						HCN.User = user;
						return done(null, user);
					},1000);
				});
			});
		}
	));

	passport.use('local-password', new LocalStrategy({
			usernameField: 'email',
			passwordField: 'password',
			passReqToCallback: true
		},
		function(req, email, password, done){
			var passwordNew = req.body.passwordNew || "";
			var passwordNewRepeat = req.body.passwordNewRepeat || "";
			if (typeof HCN.User.local === 'undefined'){
				return done(null, false, req.flash('passwordMessage', 'Please login first.'));
			}
			if (email !== HCN.User.local.id){
				return done(null, false, req.flash('passwordMessage', 'Please try again?'));
			}
			if (!validator.isByteLength(passwordNew, {min:8, max:255})){
				return done(null, false, req.flash('passwordMessage', 'The new password should be at least 8 alpha-numeric characters.'));
			}
			if (validator.isAlpha(passwordNew)){ // Numbers required
				return done(null, false, req.flash('passwordMessage', 'The new password should contain numbers and special characters.'));
			}
			if (password === passwordNew){
				return done(null, false, req.flash('passwordMessage', 'The new password must be different.'));
			}
			if (passwordNew !== passwordNewRepeat){
				return done(null, false, req.flash('passwordMessage', 'The new passwords do not match.'));
			}

			process.nextTick(function(){
				User.findOne({'local.id': email}, function(err, user){
					if(err)
						return done(err);
					if(!user){
						return done(null, false, req.flash('passwordMessage', 'You do not have an account. Please signup, first.'));
					} else {
						bcrypt.compare(password, user.local.password, function (err, match){
							if (err)
								return done(err);
							if (!match){
								return done(null, false, req.flash('passwordMessage', 'Your old password is invalid.'));
							} else {
								user.local.password = user.local.generateHash(passwordNew);
								user.local.changeme = false;

								user.save(function(err){
									if(err)
										throw err;
									// Set globally
									HCN.User = user;
									return done(null, user);
								});
							}
						});
					}
				});
			});
		}
	));

	passport.use(new FacebookStrategy({
	    clientID: configAuth.facebookAuth.clientID,
	    clientSecret: configAuth.facebookAuth.clientSecret,
	    callbackURL: configAuth.facebookAuth.callbackURL
	  },
	  function(accessToken, refreshToken, profile, done) {
			var	email = "";
			if (typeof profile.emails !== 'undefined' && profile.emails[0]){
				email = validator.normalizeEmail(profile.emails[0].value);
			}

			var account = profile.id, address = "", new_address = false;
			HCN.Api.exec('getaccountaddress', account, function(err, res){
				if (err) console.log("Error: err:" + err + " res:" + res);
				address = res;
				if (address === ""){
					// TODO: Future, use makekeypair and assign address to account
					HCN.Api.exec('getnewaddress', account, function(err, res){
						if (err) console.log("Error: err:" + err + " res:" + res);
						address = res;
						new_address = true;
						});
				}
			});

			setTimeout(function(){
	    	process.nextTick(function(){
				if (!address || address === ""){
					return done(null, false, req.flash('signupMessage', 'There was an error creating your account. Please try again later.'));
				}
	    		User.findOne({'facebook.id': profile.id}, function(err, user){
	    			if(err)
	    				return done(err); // Connection error
	    			if(user){
						// If we created a new address. Capture it.
						if (new_address){
							user.wallet.push( { node_id: HCN.Api.get('host'), account: account, address: address });
							// sendfrom <fromaccount> <tohealthcoinaddress> <amount> [minconf=1] [comment] [comment-to] [txcomment]
							HCN.Api.exec('sendfrom', HCN.MasterAccount, address, HCN.NewUserAmount, 1, "New Account", address, "Welcome to Healthcoin!", function(err, res){
								if (err) console.log("Error: err:" + err + " res:" + res);
								});
						}

						// Record last login
						user.profile.login_type = "facebook";
						user.profile.last_login = Date.now();
						user.save(function(err){
							if(err)
								throw err;
						});
						// Set globally
						HCN.User = user;
	    				return done(null, user); // User found
	    			}
	    			else {
	    				var newUser = new User(); // User not found, create one
	    				newUser.facebook.id = profile.id;
	    				newUser.facebook.token = accessToken;
						newUser.profile.login_type = "facebook";
						newUser.profile.last_login = Date.now();
						newUser.profile.role = "User";
	    				newUser.profile.name = profile.displayName;
	    				newUser.profile.email = email;
						newUser.profile.description = "";
						newUser.profile.age = "";
						newUser.profile.weight = "";
						newUser.profile.waist = "";
						newUser.profile.gender = "";
						newUser.profile.ethnicity = "";
						newUser.profile.country = "";
	                    newUser.profile.credit = 0;
						newUser.wallet.push( { node_id: HCN.Api.get('host'), account: account, address: address });

	    				newUser.save(function(err){
	    					if(err)
	    						throw err;
							// Set globally
							HCN.User = newUser;
							// sendfrom <fromaccount> <tohealthcoinaddress> <amount> [minconf=1] [comment] [comment-to] [txcomment]
							HCN.Api.exec('sendfrom', HCN.MasterAccount, address, HCN.NewUserAmount, 1, "New Account", address, "Welcome to Healthcoin!", function(err, res){
								if (err) console.log("Error: err:" + err + " res:" + res);
								});
	    					return done(null, newUser);
	    				});
	    				console.log(profile);
	    			}
	    		});
	    	});
	        },1000); // end timeout
	    }
	));

	passport.use(new GoogleStrategy({
	    clientID: configAuth.googleAuth.clientID,
	    clientSecret: configAuth.googleAuth.clientSecret,
	    callbackURL: configAuth.googleAuth.callbackURL
	  },
	  function(accessToken, refreshToken, profile, done) {
			var	email = "";
			if (typeof profile.emails !== 'undefined' && profile.emails[0]){
				email = validator.normalizeEmail(profile.emails[0].value);
			}

			var account = profile.id, address = "", new_address = false;
			HCN.Api.exec('getaccountaddress', account, function(err, res){
				if (err) console.log("Error: err:" + err + " res:" + res);
				address = res;
				if (address === ""){
					// TODO: Future, use makekeypair and assign address to account
					HCN.Api.exec('getnewaddress', account, function(err, res){
						if (err) console.log("Error: err:" + err + " res:" + res);
						address = res;
						new_address = true;
						});
				}
			});

			setTimeout(function(){
	    	process.nextTick(function(){
				if (!address || address === ""){
					return done(null, false, req.flash('signupMessage', 'There was an error creating your account. Please try again later.'));
				}
	    		User.findOne({'google.id': profile.id}, function(err, user){
	    			if(err)
	    				return done(err); // Connection error
	    			if(user){
						// If we created a new address. Capture it.
						if (new_address){
							user.wallet.push( { node_id: HCN.Api.get('host'), account: account, address: address });
							// sendfrom <fromaccount> <tohealthcoinaddress> <amount> [minconf=1] [comment] [comment-to] [txcomment]
							HCN.Api.exec('sendfrom', HCN.MasterAccount, address, HCN.NewUserAmount, 1, "New Account", address, "Welcome to Healthcoin!", function(err, res){
								if (err) console.log("Error: err:" + err + " res:" + res);
								});
						}

						// Record last login
						user.profile.login_type = "google";
						user.profile.last_login = Date.now();
						user.save(function(err){
							if(err)
								throw err;
						});
						// Set globally
						HCN.User = user;
	    				return done(null, user); // User found
	    			}
	    			else {
	    				var newUser = new User(); // User not found, create one
	    				newUser.google.id = profile.id;
	    				newUser.google.token = accessToken;
						newUser.profile.login_type = "google";
						newUser.profile.last_login = Date.now();
						newUser.profile.role = "User";
	    				newUser.profile.name = profile.displayName;
	    				newUser.profile.email = email;
						newUser.profile.description = "";
						newUser.profile.age = "";
						newUser.profile.weight = "";
						newUser.profile.waist = "";
						newUser.profile.gender = "";
						newUser.profile.ethnicity = "";
						newUser.profile.country = "";
	                    newUser.profile.credit = 0;
						newUser.wallet.push( { node_id: HCN.Api.get('host'), account: account, address: address });

	    				newUser.save(function(err){
	    					if(err)
	    						throw err;
							// Set globally
							HCN.User = newUser;
							// sendfrom <fromaccount> <tohealthcoinaddress> <amount> [minconf=1] [comment] [comment-to] [txcomment]
							HCN.Api.exec('sendfrom', HCN.MasterAccount, address, HCN.NewUserAmount, 1, "New Account", address, "Welcome to Healthcoin!", function(err, res){
								if (err) console.log("Error: err:" + err + " res:" + res);
								});
	    					return done(null, newUser);
	    				});
	    				console.log(profile);
	    			}
	    		});
	    	});
	        },1000); // end timeout
	    }
	));

	passport.use(new TwitterStrategy({
	    consumerKey: configAuth.twitterAuth.consumerKey,
	    consumerSecret: configAuth.twitterAuth.consumerSecret,
	    callbackURL: configAuth.twitterAuth.callbackURL
	  },
	  function(token, tokenSecret, profile, done) {
			var	email = "";
			if (typeof profile.emails !== 'undefined' && profile.emails[0]){
				email = validator.normalizeEmail(profile.emails[0].value);
			}

			var account = profile.id, address = "", new_address = false;
			HCN.Api.exec('getaccountaddress', account, function(err, res){
				if (err) console.log("Error: err:" + err + " res:" + res);
				address = res;
				if (address === ""){
					// TODO: Future, use makekeypair and assign address to account
					HCN.Api.exec('getnewaddress', account, function(err, res){
						if (err) console.log("Error: err:" + err + " res:" + res);
						address = res;
						new_address = true;
						});
				}
			});

			setTimeout(function(){
	    	process.nextTick(function(){
				if (!address || address === ""){
					return done(null, false, req.flash('signupMessage', 'There was an error creating your account. Please try again later.'));
				}
	    		User.findOne({'twitter.id': profile.id}, function(err, user){
	    			if(err)
	    				return done(err); // Connection error
	    			if(user){
						// If we created a new address. Capture it.
						if (new_address){
							user.wallet.push( { node_id: HCN.Api.get('host'), account: account, address: address });
							// sendfrom <fromaccount> <tohealthcoinaddress> <amount> [minconf=1] [comment] [comment-to] [txcomment]
							HCN.Api.exec('sendfrom', HCN.MasterAccount, address, HCN.NewUserAmount, 1, "New Account", address, "Welcome to Healthcoin!", function(err, res){
								if (err) console.log("Error: err:" + err + " res:" + res);
								});
						}

						// Record last login
						user.profile.login_type = "twitter";
						user.profile.last_login = Date.now();
						user.save(function(err){
							if(err)
								throw err;
						});
						// Set globally
						HCN.User = user;
	    				return done(null, user); // User found
	    			}
	    			else {
	    				var newUser = new User(); // User not found, create one
	    				newUser.twitter.id = profile.id;
	    				newUser.twitter.token = token;
						newUser.profile.login_type = "twitter";
						newUser.profile.last_login = Date.now();
						newUser.profile.role = "User";
	    				newUser.profile.name = profile.displayName;
	    				newUser.profile.email = email;
						newUser.profile.description = "";
						newUser.profile.age = "";
						newUser.profile.weight = "";
						newUser.profile.waist = "";
						newUser.profile.gender = "";
						newUser.profile.ethnicity = "";
						newUser.profile.country = "";
	                    newUser.profile.credit = 0;
						newUser.wallet.push( { node_id: HCN.Api.get('host'), account: account, address: address });

	    				newUser.save(function(err){
							if(err)
								throw err;
							// Set globally
							HCN.User = newUser;
							// sendfrom <fromaccount> <tohealthcoinaddress> <amount> [minconf=1] [comment] [comment-to] [txcomment]
							HCN.Api.exec('sendfrom', HCN.MasterAccount, address, HCN.NewUserAmount, 1, "New Account", address, "Welcome to Healthcoin!", function(err, res){
								if (err) console.log("Error: err:" + err + " res:" + res);
								});
	    					return done(null, newUser);
	    				});
	    				console.log(profile);
	    			}
	    		});
	    	});
	        },1000); // end timeout
	    }
	));
};
