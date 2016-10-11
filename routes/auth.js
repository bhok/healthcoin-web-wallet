var User = require('../healthcoin/user');
module.exports = function(app, passport){

	app.get('/', isLoggedIn, function(req, res){
		res.render('healthcoin.ejs'); // If logged in, allow access to Healthcoin App
	});

	// Stupid Facebook callback bug in Chrome. https://developers.facebook.com/bugs/196125357123225
	app.get('/#_=_', function(req, res){ // TODO: Fix not working
		res.redirect('/'); // If logged in, allow access to Healthcoin App
	});

	app.get('/login', function(req, res){
		res.render('login.ejs', { message: req.flash('loginMessage') });
	});
	app.post('/login', passport.authenticate('local-login', {
		successRedirect: '/',
		failureRedirect: '/login',
		failureFlash: true
	}));

	app.get('/signup', function(req, res){
		res.render('signup.ejs', { message: req.flash('signupMessage') });
	});

	app.post('/signup', passport.authenticate('local-signup', {
		successRedirect: '/',
		failureRedirect: '/signup',
		failureFlash: true
	}));

	// Facebook auth
	app.get('/auth/facebook', passport.authenticate('facebook', {scope: ['email', 'public_profile']}));
	app.get('/auth/facebook/callback', 
	  passport.authenticate('facebook', { successRedirect: '/',
	                                      failureRedirect: '/' })
	);

	// Google auth
	app.get('/auth/google', passport.authenticate('google', {scope: ['profile', 'email']}));
	app.get('/auth/google/callback', 
	  passport.authenticate('google', { successRedirect: '/',
	                                    failureRedirect: '/' })
	);

	// Twitter auth
	app.get('/auth/twitter', passport.authenticate('twitter', {scope: ['email']}));
	app.get('/auth/twitter/callback', 
	  passport.authenticate('twitter', { successRedirect: '/',
	                                     failureRedirect: '/' })
	);

	app.get('/logout', function(req, res){
		req.logout();
		res.redirect('/');
	});
};

function isLoggedIn(req, res, next) {
	if(req.isAuthenticated()){
		return next();
	}
	res.render('index.ejs');
}
