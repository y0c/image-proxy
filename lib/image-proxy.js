// @see https://devcenter.heroku.com/articles/nodejs#write-your-app

var express = require('express')
  , fs      = require('fs') // node
  , gm      = require('gm')
  , http    = require('http') // node
  , https   = require('https') // node
  , mime    = require('mime')
  , url     = require('url') // node
  // @see http://aaronheckmann.posterous.com/graphicsmagick-on-heroku-with-nodejs
  , app = express()
  , imageMagick = gm.subClass({imageMagick: true})
  , whitelist = process.env.WHITELIST || [] // [/\.gov$/, /google\.com$/]
  , delay = parseInt(process.env.DELAY) || 5000
  , mimeTypes = [
    'image/gif',
    'image/jpeg',
    'image/png',
    // Common typos
    'image/jpg',
  ];

module.exports = function () {

  app.get('/:url/:width/:height', function (req, res, next) {
    var width = req.params.width
      , height = req.params.height
      , retrieve = function (remote) {
        // @see http://nodejs.org/api/url.html#url_url
        var parts = url.parse(remote);
        if (parts.protocol !== 'http:' && parts.protocol !== 'https:') {
          return res.status(404).send('Expected URI scheme to be HTTP or HTTPS');
        }
        if (!parts.hostname) {
          return res.status(404).send('Expected URI host to be non-empty');
        }

        var agent = parts.protocol === 'http:' ? http : https
          // @see http://nodejs.org/api/http.html#http_http_get_options_callback
          , req2 = agent.get(parts, function (res2) {
            // @see http://nodejs.org/api/http.html#http_response_statuscode
            if ((res2.statusCode === 301 || res2.statusCode === 302) && res2.headers['location']) {
              return retrieve(res2.headers['location']);
            }

            // The image must return status code 200.
            if (res2.statusCode !== 200) {
              return res.status(404).send('Expected response code 200, got ' + res2.statusCode);
            }

            // The image must be a valid content type.
            // @see http://nodejs.org/api/http.html#http_request_headers
            var mimeType = (res2.headers['content-type'] || '').replace(/;.*/, '');
            if (mimeTypes.indexOf(mimeType) === -1) {
              return res.status(404).send('Expected content type ' + mimeTypes.join(', ') + ', got ' + mimeType);
            }

            // @see https://github.com/aheckmann/gm#constructor
            imageMagick(res2, 'image.' + mime.extension(mimeType))
            // @see http://www.imagemagick.org/Usage/thumbnails/#cut
            .resize(width, height + '^>')
            .gravity('Center') // faces are most often near the center
            .extent(width, height)
            .stream(function (err, stdout, stderr) {
              if (err) return next(err);
              // Log errors in production.
              stderr.pipe(process.stderr);
              // @see http://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Expiration.html
              res.writeHead(200, {
                'Content-Type': mimeType,
                'Cache-Control': 'max-age=31536000, public', // 1 year
              });
              stdout.pipe(res);
            });
          }).on('error', next);

        // Timeout after five seconds. Better luck next time.
        req2.setTimeout(delay, function () {
          return res.status(504).send();
        });
      };

    // Validate parameters.
    if (whitelist.length) {
      var parts = url.parse(req.params.url);
      if (parts.hostname) {
        var any = false, _i, _len;
        if (typeof whitelist === 'string') {
          whitelist = whitelist.split(',');
        }
        for (_i = 0, _len = whitelist.length; _i < _len; _i++) {
          if (typeof whitelist[_i] === 'string') {
            // Escape periods and add anchor.
            whitelist[_i] = new RegExp(whitelist[_i].replace('.', '\\.') + '$')
          }
          if (whitelist[_i].test(parts.hostname)) {
            any = true;
            break;
          }
        }
        if (!any) { // if none
          return res.status(404).send('Expected URI host to be whitelisted');
        }
      }
    }
    if (isNaN(parseInt(width))) {
      return res.status(404).send('Expected width to be an integer');
    }
    if (parseInt(width) > 1000) {
      return res.status(404).send('Expected width to be less than or equal to 1000');
    }
    if (isNaN(parseInt(height))) {
      return res.status(404).send('Expected height to be an integer');
    }
    if (parseInt(height) > 1000) {
      return res.status(404).send('Expected height to be less than or equal to 1000');
    }

    retrieve(req.params.url);
  });

  return app;
};