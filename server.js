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

    if (parsedUrl.pathname == '/getAthleteActivitiesSummary.html') {     // web service call
        athleteId = parsedUrl.query.id;
        getAthleteActivitiesSummary(response);
        return;
    }
    else if (request.url == '/') {                              // default to index.html
        filePath = 'public/index.html';
    } else {                                                    // serve static file
        parsedUrl = url.parse(request.url);
        filePath = "public" + parsedUrl.pathname;
    }
    var absPath = './' + filePath;
    serveStatic(response, cache, absPath);
});


server.listen(8080, function () {
    console.log("Server listening on port 8080.");
});


// get a list of activities for the authenticated user
function getAthleteActivitiesSummary(response) {

    console.log('getAthleteActivitiesSummary invoked');

    var options = {
        host: 'www.strava.com',
        path: '/api/v3/athlete/activities',
        port: 443,
        headers: {
            'Authorization': 'Bearer ' + 'fb8085cc4c7f3633533e875eae3dc1e04cef06e8'
        }
    };

    str = ""

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

    str = ""

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


