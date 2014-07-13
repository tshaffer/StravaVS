var http = require('http');
var https = require('https');
var fs = require('fs');
var path = require('path');
var mime = require('mime');
var url = require('url');
var mysql = require('mysql');

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

console.log('create connection');

var db = mysql.createConnection({
    host: '127.0.0.1',
    user: 'ted',
    password: 'ted69',
    database: 'strava'
});

console.log("connect");

db.connect();

db.query(
  "CREATE TABLE IF NOT EXISTS authenticatedAthlete ("
  + "athleteId VARCHAR(32) NOT NULL, "
  + "authorizationKey VARCHAR(64) NOT NULL,"
  + "PRIMARY KEY(athleteId))",
  function (err) {
      if (err) throw err;
      console.log("create authenticatedAthlete successful");
      // note - should not proceed to createServer until this callback is executed
  }
);

db.query(
  "CREATE TABLE IF NOT EXISTS detailedActivity ("
  + "activityId VARCHAR(32) NOT NULL, "
  + "athleteId VARCHAR(32) NOT NULL, "
  + "name VARCHAR(64) NOT NULL, "
  + "description VARCHAR(256) NOT NULL, "
  + "distance FLOAT NOT NULL, "
  + "movingTime INT NOT NULL, "
  + "elapsedTime INT NOT NULL, "
  + "totalElevationGain INT NOT NULL, "
  + "startDateTime DATE NOT NULL, "
  + "averageSpeed FLOAT NOT NULL, "
  + "maxSpeed FLOAT NOT NULL, "
  + "calories INT NOT NULL, "
  + "PRIMARY KEY(activityId))",
  function (err) {
      if (err) throw err;
      console.log("create detailedActivity successful");
      // note - should not proceed to createServer until this callback is executed
  }
);

db.query(
  "CREATE TABLE IF NOT EXISTS segmenteffort ("
  + "segmentEffortId VARCHAR(32) NOT NULL, "
  + "name VARCHAR(128) NOT NULL, "
  + "movingTime INT NOT NULL, "
  + "elapsedTime INT NOT NULL, "
  + "startDateTime DATE NOT NULL, "
  + "distance FLOAT NOT NULL, "
  + "PRIMARY KEY(segmentEffortId))",
  function (err) {
      if (err) throw err;
      console.log("create segmenteffort successful");
      // note - should not proceed to createServer until this callback is executed
  }
);

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

    // post token to Strava server; get back authentication key
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

            // add the authentication data to the data base if it's not already there

            // is the athlete already in the database?
            console.log("query for existing athlete entry");
            var query = "SELECT * FROM authenticatedathlete " +
              "WHERE athleteId=?";
            db.query(
              query,
              [authenticationData.athleteId.toString()],
              function (err, rows) {
                  if (err) throw err;
                  console.log("return from query - rows length = " + rows.length);

                  if (rows.length == 0) {
                      console.log("add authentication data to the db");

                      db.query(
                        "INSERT INTO authenticatedathlete (athleteId, authorizationKey) " +
                        " VALUES (?, ?)",
                        [authenticationData.athleteId.toString(), authenticationData.accessToken],
                        function (err) {
                            if (err) throw err;
                            console.log("added authenticated athlete successfully");
                            // in theory, shouldn't necessarily execute steps below until this callback is executed
                        }
                      );
                  }
                  else {
                      console.log("The following row was returned from the db");
                      console.log(rows[0]);
                      // todo? - check that the authenticationKey hasn't changed. If it has, update the db?
                  }
              }
            );


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
    console.log("authorizationKey = " + authorizationKey);

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

var activityIds = [];
var detailedActivities = [];
var segmentEfforts = [];

function getMySqlDateTime(isoDateTime) {
    jsDateTime = new Date(isoDateTime);
    console.log("jsDateTime = " + jsDateTime);

    // date conversion
    var year, month, day;
    year = String(jsDateTime.getFullYear());
    month = String(jsDateTime.getMonth() + 1);
    if (month.length == 1) {
        month = "0" + month;
    }
    day = String(jsDateTime.getDate());
    if (day.length == 1) {
        day = "0" + day;
    }
    return year + "-" + month + "-" + day;
}

function addDetailedActivityToDB(detailedActivity) {

    activityId = detailedActivity.id.toString();
    athleteId = detailedActivity.athlete.id.toString();
    name = detailedActivity.name;
    description = detailedActivity.description;
    distance = detailedActivity.distance * 0.000621371;
    movingTime = detailedActivity.moving_time;
    elapsedTime = detailedActivity.elapsed_time;
    totalElevationGain = Math.floor(detailedActivity.total_elevation_gain * 3.28084);
    averageSpeed = detailedActivity.average_speed * 2.23694;
    maxSpeed = detailedActivity.max_speed * 2.23694;
    calories = detailedActivity.calories;
    startDateTime = getMySqlDateTime(detailedActivity.start_date_local);
    console.log("mySql datetime = " + startDateTime);

    db.query(
      "INSERT INTO detailedactivity (activityId, athleteId, name, description, distance, movingTime, elapsedTime, totalElevationGain, startDateTime, averageSpeed, maxSpeed, calories) " +
      " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [activityId, athleteId, name, description, distance, movingTime, elapsedTime, totalElevationGain, startDateTime, averageSpeed, maxSpeed, calories],
      function (err) {
          if (err) throw err;
          console.log("added detailed activity successfully");

          // get segment efforts for this detailed activity
          // create a list of segmentEfforts
          segmentEfforts = [];
          function saveSegmentEffort(segmentEffort, index, array) {
              console.log("save segmentEffort whose id is " + segmentEffort.id);
              segmentEfforts.push(segmentEffort);
          }
          detailedActivity.segment_efforts.forEach(saveSegmentEffort);

          // add segment efforts to the db
          if (segmentEfforts.length > 0) {
              console.log("number of segmentEfforts is " + segmentEfforts.length);
              segmentEffort = segmentEfforts.shift();
              console.log("grabbed first segmentEffort");
              console.log("initial segmentEffort Id is " + segmentEffort.id);
              addSegmentEffortToDB(segmentEffort);
          }
          else {
          }
      }
    );
}

function addSegmentEffortToDB(segmentEffort) {
    segmentEffortId = segmentEffort.id.toString();
    name = segmentEffort.name;
    movingTime = segmentEffort.moving_time;
    elapsedTime = segmentEffort.elapsed_time;
    startDateTime = getMySqlDateTime(segmentEffort.start_date_local);
    distance = segmentEffort.distance * 0.000621371;

    db.query(
      "INSERT INTO segmenteffort (segmentEffortId, name, movingTime, elapsedTime, startDateTime, distance) " +
      " VALUES (?, ?, ?, ?, ?, ?)",
      [segmentEffortId, name, movingTime, elapsedTime, startDateTime, distance],
      function (err) {
          if (err) throw err;
          console.log("added detailed activity successfully");

          // add next segment effort
          if (segmentEfforts.length > 0) {
              console.log("number of segmentEfforts is " + segmentEfforts.length);
              segmentEffort = segmentEfforts.shift();
              console.log("grabbed next segmentEffort");
              console.log("next segmentEffort Id is " + segmentEffort.id);
              addSegmentEffortToDB(segmentEffort);
          }
          else {
              // add next detailed activity to db
              if (detailedActivities.length > 0) {
                  console.log("number of remaining detailedActivities is " + detailedActivities.length);
                  detailedActivity = detailedActivities.shift();
                  addDetailedActivityToDB(detailedActivity);
              }
          }
      }
    );

}

function addDetailedActivitiesToDB() {
    if (detailedActivities.length > 0) {
        console.log("number of remaining detailedActivities is " + detailedActivities.length);
        detailedActivity = detailedActivities.shift();
        addDetailedActivityToDB(detailedActivity);
    }
}

function getDetailedActivityData(activityId) {
    console.log("getDetailedActivityData invoked with activityId = " + activityId + ", accessToken = " + accessToken);

    var options = {
        host: 'www.strava.com',
        path: '/api/v3/activities/' + activityId.toString(),
        port: 443,
        headers: {
            'Authorization': 'Bearer ' + accessToken
        }
    };

    console.log("almost complete url is " + options.host + options.path);

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

            detailedActivityData = JSON.parse(str);
            detailedActivities.push(detailedActivityData);

            var activity;

            if (activityIds.length > 0) {
                console.log("number of remaining activities is " + activityIds.length);
                activityId = activityIds.shift();
                console.log("grabbed next activityId");
                console.log("current activity id is " + activityId);
                getDetailedActivityData(activityId);
            }
            else {
                // save all detailed activity data in the database
                addDetailedActivitiesToDB();
            }

            // just doing one for now
            addDetailedActivitiesToDB();

        });

    }).on('error', function () {
        console.log('Caught exception: ' + err);
    });

}

var accessToken;

// get a list of activities for the authenticated user
function listAthleteActivities(response, athleteId) {

    console.log('listAthleteActivities invoked');
    console.log('athleteId=', athleteId);
    console.log("type of athleteId is " + typeof athleteId);

    console.log("query for existing athlete entry");
    var query = "SELECT * FROM authenticatedathlete " +
      "WHERE athleteId=?";
    db.query(
      query,
      [athleteId],
      function (err, rows) {
          if (err) throw err;
          console.log("return from query - rows length = " + rows.length);

          if (rows.length == 0) {
              console.log("authentication data not found for this athlete");
              // to do - redirect user back to connect page
          }
          else {
              //console.log("The following row was returned from the db");
              //console.log(rows[0]);

              accessToken = rows[0].authorizationKey;
              console.log("retrieved accessToken " + accessToken);

              // todo? - check that the authenticationKey hasn't changed from what is stored in the db. If it has, update the db?

              var options = {
                  host: 'www.strava.com',
                  path: '/api/v3/athlete/activities',
                  port: 443,
                  headers: {
                      'Authorization': 'Bearer ' + accessToken
                  }
              };

              var str = ""

              activityIds = [];

              // fetch up to date activity data from the server
              // this data includes the summary activities for the authenticated athlete. however, we want to return the detailed activities for the authenticated athlete.
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

                      // need to return detailed activities. see if the corresponding detailed activities are in the db.
                      // for each one that is not, fetch it from Strava and add it to the db. then return the data to the user

                      // TODO - get detailed activities for the current athlete from the db

                      // create a list of activity id's
                      function saveActivity(activity, index, array) {
                          console.log("save activity id " + activity.id);
                          activityIds.push(activity.id);
                      }
                      activities.forEach(saveActivity);
                      //$.each(activities, function (index, activity) {
                      //    console.log("save activity id " + activity.id);
                      //});

                      var activity;

                      if (activityIds.length > 0) {
                          console.log("number of activities is " + activityIds.length);
                          activityId = activityIds.shift();
                          console.log("grabbed first activityId");
                          console.log("initial activity id is " + activityId);
                          getDetailedActivityData(activityId);
                      }

                      //response.writeHead(
                      //    200,
                      //    { "content-type": 'application/json' }
                      //    );
                      //response.end(JSON.stringify(activities, null, 3));
                  });

              }).on('error', function () {
                  console.log('Caught exception: ' + err);
              });
          }
      }
    );

    // all this stuff needs to get done in the callback from the db query
    //var options = {
    //    host: 'www.strava.com',
    //    path: '/api/v3/athlete/activities',
    //    port: 443,
    //    headers: {
    //        'Authorization': 'Bearer ' + 'fb8085cc4c7f3633533e875eae3dc1e04cef06e8'
    //    }
    //};

    //var str = ""

    //https.get(options, function (res) {
    //    //console.log('STATUS: ' + res.statusCode);
    //    //console.log('HEADERS: ' + JSON.stringify(res.headers));

    //    res.on('data', function (d) {
    //        console.log("chunk received");
    //        str += d;
    //    });
    //    res.on('end', function () {
    //        console.log("end received");
    //        //console.log(str);

    //        activities = JSON.parse(str);
    //        console.log(activities[0].id);

    //        response.writeHead(
    //            200,
    //            { "content-type": 'application/json' }
    //            );
    //        response.end(JSON.stringify(activities, null, 3));
    //    });

    //}).on('error', function () {
    //    console.log('Caught exception: ' + err);
    //});
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


