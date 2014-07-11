var http = require('http');
var https = require('https');
var fs = require('fs');
var path = require('path');
var mime = require('mime');
var url = require('url');

var cache = {};

function send404(response) {
  response.writeHead(404, {'Content-Type': 'text/plain'});
  response.write('Error 404: resource not found.');
  response.end();
}

function sendFile(response, filePath, fileContents) {
  response.writeHead(
    200,
    {"content-type": mime.lookup(path.basename(filePath))}
  );
  response.end(fileContents);
}

function serveStatic(response, cache, absPath) {
    if (cache[absPath]) {
        sendFile(response, absPath, cache[absPath]);
    } else {
        fs.exists(absPath, function(exists) {
            if (exists) {
                fs.readFile(absPath, function(err, data) {
                    if (err) {
                        send404(response);
                    } else {
                        //cache[absPath] = data;
                        sendFile(response, absPath, data);
                    }
                });
            } else {
                send404(response);
            }
        });
    }
}

var server = http.createServer(function (request, response) {
    var filePath = false;

    parsedUrl = url.parse(request.url, true);
    console.log(request.url);
    console.log(parsedUrl.pathname);
    console.log(parsedUrl.query);

    if (parsedUrl.pathname == '/StravaStatsHome.html') {                  // part of authentication
        console.log("StravaStatsHome invoked");
        console.log("query is ");
        console.log(parsedUrl.query);
        performTokenExchange(response, parsedUrl.query.code);
        return;
    }
    else if (parsedUrl.pathname == '/listAthleteActivities.html') {          // web service call
        listAthleteActivities(response, parsedUrl.query.athleteId);
        return;
    }
    else if (parsedUrl.pathname == '/getDetailedActivity.html') {       // web service call
        activityId = parsedUrl.query.id;
        getDetailedActivity(response, activityId);
        return;
    }
    else if (parsedUrl.pathname == '/getSegmentEffortsForAthlete.html') {
        segmentId = parsedUrl.query.segment_id;
        athleteId = parsedUrl.query.athlete_id;
        getSegmentEffortsForAthlete(response, segmentId, athleteId);
        return;
    }
    else if (request.url == '/') {                                      // default to index.html
        filePath = 'public/index.html';
    } else {                                                            // serve static file
        parsedUrl = url.parse(request.url);
        filePath = "public" + parsedUrl.pathname;
    }
    var absPath = './' + filePath;
    serveStatic(response, cache, absPath);
});


server.listen(8080, function () {
    console.log("Server listening on port 8080.");
});


var authenticationData = {};

// perform token exchange with Strava server
function performTokenExchange(response, code) {

    console.log("Code is " + parsedUrl.query.code);

    code = parsedUrl.query.code;

    postData = {}

    postData.client_id = 2055;
    postData.client_secret = "85f821429c9da1ef02b627058119a4253eafd16d";
    postData.code = code;

    var postDataStr = JSON.stringify(postData);

    var options = {
        hostname: 'www.strava.com',
        port: 443,
        path: '/oauth/token',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': postDataStr.length
        }
    };

    var str = ""

    var req = https.request(options, function (res) {
        //console.log('STATUS: ' + res.statusCode);
        //console.log('HEADERS: ' + JSON.stringify(res.headers));
        res.setEncoding('utf8');
        res.on('data', function (chunk) {
            console.log("data received");
            str += chunk;
        });
        res.on('end', function () {
            console.log("end received");
            console.log(str);

            data = JSON.parse(str);

            authenticationData = {};
            authenticationData.accessToken = data.access_token;
            authenticationData.athleteId = data.athlete.id;

            console.log("the authentication data is");
            console.log(authenticationData);

            filePath = "public" + "/StravaStatsHome.html";
            var absPath = './' + filePath;

            fs.exists(absPath, function (exists) {
                if (exists) {
                    fs.readFile(absPath, function (err, data) {
                        if (err) {
                            send404(response);
                        } else {
                            // replace placeholder for athlete id with the real value
                            console.log("search for data-athlete");
                            var dataAsStr = String(data);
                            //var finalDataAsStr = dataAsStr.replace("athleteIdPlaceholder", authenticationData.athleteId.toString());
                            var finalDataAsStr = dataAsStr.replace("athleteIdPlaceholder", authenticationData.athleteId);
                            sendFile(response, absPath, finalDataAsStr);
                        }
                    });
                } else {
                    send404(response);
                }
            });

        });
    });

    req.on('error', function (e) {
        console.log('problem with request: ' + e.message);
    });

    // write data to request body
    req.write(postDataStr);
    req.end();
}

// get segment efforts for a friend
function getSegmentEffortsForAthlete(response, segmentId, athleteId) {
    console.log('getSegmentEffortsForAthlete invoked, segmentId = ' + segmentId + ', athleteId = ' + athleteId);

    var options = {
        host: 'www.strava.com',
        path: '/api/v3/segments/' + segmentId.toString() + '/all_efforts?athlete_id=' + athleteId.toString(),
        port: 443,
        headers: {
            'Authorization': 'Bearer ' + 'fb8085cc4c7f3633533e875eae3dc1e04cef06e8'
        }
    };

    console.log("complete url is " + options.host + options.path);

    var str = ""

    https.get(options, function (res) {
        console.log('STATUS: ' + res.statusCode);
        console.log('HEADERS: ' + JSON.stringify(res.headers));

        res.on('data', function (d) {
            console.log("chunk received");
            str += d;
        });
        res.on('end', function () {
            console.log("end received");
            //console.log(str);

            data = JSON.parse(str);

            response.writeHead(
                200,
                { "content-type": 'application/json' }
                );
            response.end(JSON.stringify(data, null, 3));
        });

    }).on('error', function () {
        console.log('Caught exception: ' + err);
    });
}

// get detailed activity
function getDetailedActivity(response, activityId) {
    console.log('getDetailedActivity invoked, id = ' + activityId);

    var options = {
        host: 'www.strava.com',
        path: '/api/v3/activities/' + activityId.toString(),
        port: 443,
        headers: {
            'Authorization': 'Bearer ' + 'fb8085cc4c7f3633533e875eae3dc1e04cef06e8'
        }
    };

    console.log("almost complete url is " + options.host + options.path);

    var str = ""

    https.get(options, function (res) {
        console.log('STATUS: ' + res.statusCode);
        console.log('HEADERS: ' + JSON.stringify(res.headers));

        res.on('data', function (d) {
            console.log("chunk received");
            str += d;
        });
        res.on('end', function () {
            console.log("end received");
            //console.log(str);

            activityData = JSON.parse(str);

            response.writeHead(
                200,
                { "content-type": 'application/json' }
                );
            response.end(JSON.stringify(activityData, null, 3));
        });

    }).on('error', function () {
        console.log('Caught exception: ' + err);
    });
}

// get a list of activities for the authenticated user
function listAthleteActivities(response, athleteId) {

    console.log('listAthleteActivities invoked');
    console.log('athleteId=', athleteId);

    var options = {
        host: 'www.strava.com',
        path: '/api/v3/athlete/activities',
        port: 443,
        headers: {
            'Authorization': 'Bearer ' + 'fb8085cc4c7f3633533e875eae3dc1e04cef06e8'
        }
    };

    var str = ""

    https.get(options, function (res) {
        //console.log('STATUS: ' + res.statusCode);
        //console.log('HEADERS: ' + JSON.stringify(res.headers));

        res.on('data', function (d) {
            console.log("chunk received");
            str += d;
        });
        res.on('end', function () {
            console.log("end received");
            //console.log(str);

            activities = JSON.parse(str);
            console.log(activities[0].id);

            response.writeHead(
                200,
                { "content-type": 'application/json' }
                );
            response.end(JSON.stringify(activities, null, 3));
        });

    }).on('error', function () {
        console.log('Caught exception: ' + err);
    });
}

//var server = http.createServer(function(request, response) {
//    var filePath = false;

//    if (request.url == '/') {
//        filePath = 'public/index.html';
//        var absPath = './' + filePath;
//        serveStatic(response, cache, absPath);
//    } else if (request.url == '/showActivities.html')
//    {
//        showActivities(response);
//    } else {
//        //filePath = 'public' + request.url;
//        //console.log("filePath = " + filePath);
//        parsedUrl = url.parse(request.url);
//        filePath = "public" + parsedUrl.pathname;
//        var absPath = './' + filePath;
//        serveStatic(response, cache, absPath);
//    }
//    //var absPath = './' + filePath;
//    //serveStatic(response, cache, absPath);
//});

function showActivities(response) {
    console.log('showActivities invoked');
    //https.get("https://www.strava.com/api/v3/athlete/activities?access_token=fb8085cc4c7f3633533e875eae3dc1e04cef06e8", function (res) {
    //    console.log("Got response: " + res.statusCode);
    //}).on('error', function (e) {
    //    console.log("Got error: " + e.message);
    //});


    // WORKS (both ways; athlete activities request and some other detailed info)
    var options = {
        host: 'www.strava.com',
        //path: '/api/v3/activities/158581862',
        path: '/api/v3/athlete/activities',
        port: 443,
        headers: {
            'Authorization': 'Bearer ' + 'fb8085cc4c7f3633533e875eae3dc1e04cef06e8'
        }
    };

    //https.get('https://www.strava.com/api/v3/athlete/activities?access_token=fb8085cc4c7f3633533e875eae3dc1e04cef06e8', function (res) {

    var str = ""

    https.get(options, function (res) {
        console.log('STATUS: ' + res.statusCode);
        console.log('HEADERS: ' + JSON.stringify(res.headers));

        res.on('data', function (d) {
            console.log("chunk received");
            str += d;
        });
        res.on('end', function () {
            console.log("end received");
            //console.log(str);

            activities = JSON.parse(str);
            console.log(activities[0].id);

            response.writeHead(
                200,
                { "content-type": 'application/json' }
                );
            //response.end(JSON.stringify({ activities: 1 }, null, 3));
            response.end(JSON.stringify(activities, null, 3));
        });

    }).on('error', function () {
        console.log('Caught exception: ' + err);
    });




    //str = ""

    //var options = {
    //    host: 'www.strava.com',
    //    port: 443,
    //    path: '/api/v3/athlete/activities?access_token=fb8085cc4c7f3633533e875eae3dc1e04cef06e8',
    //    method: 'GET',
    //    secureProtocol: 'SSLv3_method'
    //};

    //console.log('make request');
    //var req = https.request(options, function (res) {
    //    console.log('STATUS: ' + res.statusCode);
    //    console.log('HEADERS: ' + JSON.stringify(res.headers));
    //    res.setEncoding('utf8');
    //    res.on('error', function (err) {
    //        console.log("got an error");
    //    });
    //    res.on('data', function (d) {
    //        console.log("chunk received");
    //        str += d;
    //    });
    //    res.on('end', function () {
    //        console.log("end received");
    //        //console.log(str);

    //        activities = JSON.parse(str);
    //        console.log(activities[0].id);
    //    });

    //    // write data to request body
    //    req.write('data\n');
    //    req.write('data\n');
    //    req.end();
    //}).on('error', function (err) {
    //    //console.log("error");
    //    console.log('Caught exception: ' + err);
    //});




    // the following worked (did not crash) but there's no way of knowing if the headers were added
    //var options = {
    //    host: 'www.strava.com',
    //    port: 443,
    //    path: '/api/v3/athlete/activities?access_token=fb8085cc4c7f3633533e875eae3dc1e04cef06e8',
    //    headers: {
    //        'pizza': 'tasty'
    //    }
    //};

    //str = ""

    //https.get(options, function(res) {
    //    console.log('STATUS: ' + res.statusCode);
    //    console.log('HEADERS: ' + JSON.stringify(res.headers));

    //    res.on('data', function (d) {
    //        console.log("chunk received");
    //        str += d;
    //    });
    //    res.on('end', function () {
    //        console.log("end received");
    //        //console.log(str);

    //        activities = JSON.parse(str);
    //        console.log(activities[0].id);
    //    });

    //}).on('error', function () {
    //    console.log('Caught exception: ' + err);
    //});




    // WORKS
    //str = ""

    //https.get('https://www.strava.com/api/v3/athlete/activities?access_token=fb8085cc4c7f3633533e875eae3dc1e04cef06e8', function (res) {
    //    console.log("statusCode: ", res.statusCode);
    //    //console.log("headers: ", res.headers);

    //    res.on('data', function (d) {
    //        console.log("chunk received");
    //        str += d;
    //    });
    //    res.on('end', function () {
    //        console.log("end received");
    //        //console.log(str);

    //        activities = JSON.parse(str);
    //        console.log(activities[0].id);
    //    });

    //}).on('end', function () {
    //    console.log(str);
    //});









    //}).on('error', function (e) {
    //    console.error(e);
    //});

    var str = '';

    //var options = {
    //    host: 'https://www.strava.com',
    //    path: '/api/v3/athlete/activities?access_token=fb8085cc4c7f3633533e875eae3dc1e04cef06e8'
    //};

    //callback = function (response) {

    //    response.on('data', function (chunk) {
    //        console.log("chunk received");
    //        str += chunk;
    //    });

    //    response.on('end', function () {
    //        console.log("end received");
    //        console.log(req.data);
    //        console.log(str);
    //        // your code here if you want to use the results !
    //    });
    //}

    //var req = http.request(options, callback).end();
}


