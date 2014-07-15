var http = require('http');
var https = require('https');
var fs = require('fs');
var path = require('path');
var mime = require('mime');
var url = require('url');
var mysql = require('mysql');

var cache = {};
var authenticationData = {};
var activityIds = [];
var detailedActivityIdsToFetch = [];
var detailedActivities = [];
var segmentEfforts = [];
var accessToken;

//var detailedActivitiesToReturn = [];
var fetchedActivities = [];

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
          //if (err) throw err;
          if (err) {
              console.log("db error in addSegmentEffortToDB");
          }
          else {
              console.log("added detailed activity successfully");
          }
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
              if (fetchedActivities.length > 0) {
                  console.log("number of remaining detailedActivities is " + fetchedActivities.length);
                  detailedActivity = fetchedActivities.shift();
                  addDetailedActivityToDB(detailedActivity);
              }
              else {
                  console.log("ended up here which means i need to look at this code more");
              }
          }
      }
    );
}

//function addDetailedActivityToDB(detailedActivity) {

//    activityId = detailedActivity.id.toString();
//    athleteId = detailedActivity.athlete.id.toString();
//    name = detailedActivity.name;
//    description = detailedActivity.description;
//    distance = detailedActivity.distance * 0.000621371;
//    movingTime = detailedActivity.moving_time;
//    elapsedTime = detailedActivity.elapsed_time;
//    totalElevationGain = Math.floor(detailedActivity.total_elevation_gain * 3.28084);
//    averageSpeed = detailedActivity.average_speed * 2.23694;
//    maxSpeed = detailedActivity.max_speed * 2.23694;
//    calories = detailedActivity.calories;
//    startDateTime = getMySqlDateTime(detailedActivity.start_date_local);
//    console.log("mySql datetime = " + startDateTime);

//    db.query(
//      "INSERT INTO detailedactivity (activityId, athleteId, name, description, distance, movingTime, elapsedTime, totalElevationGain, startDateTime, averageSpeed, maxSpeed, calories) " +
//      " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
//      [activityId, athleteId, name, description, distance, movingTime, elapsedTime, totalElevationGain, startDateTime, averageSpeed, maxSpeed, calories],
//      function (err) {
//          if (err) throw err;
//          console.log("added detailed activity successfully");

//          // get segment efforts for this detailed activity
//          // create a list of segmentEfforts
//          segmentEfforts = [];
//          function saveSegmentEffort(segmentEffort, index, array) {
//              console.log("save segmentEffort whose id is " + segmentEffort.id);
//              segmentEfforts.push(segmentEffort);
//          }
//          detailedActivity.segment_efforts.forEach(saveSegmentEffort);

//          // add segment efforts to the db
//          if (segmentEfforts.length > 0) {
//              console.log("number of segmentEfforts is " + segmentEfforts.length);
//              segmentEffort = segmentEfforts.shift();
//              console.log("grabbed first segmentEffort");
//              console.log("initial segmentEffort Id is " + segmentEffort.id);
//              addSegmentEffortToDB(segmentEffort);
//          }
//          else {
//              sendActivitiesResponse();
//          }
//      }
//    );
//}

function addDetailedActivitiesToDB() {

    // add the newly fetched activities to the db
    if (fetchedActivities.length > 0) {
        console.log("number of remaining detailedActivities is " + fetchedActivities.length);
        detailedActivity = fetchedActivities.shift();
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
            detailedActivities.push(detailedActivityData); // obsolete
            detailedActivitiesToReturn.push(detailedActivityData);
            fetchedActivities.push(detailedActivityData); // keep track of which ones to add to the db

            if (detailedActivityIdsToFetch.length > 0) {
                console.log("number of remaining activities is " + detailedActivityIdsToFetch.length);
                activityId = detailedActivityIdsToFetch.shift();
                console.log("grabbed next activityId");
                console.log("current activity id is " + activityId);
                getDetailedActivityData(activityId);
            }
            else {
                // save new detailed activity data in the database
                addDetailedActivitiesToDB();
            }
        });

    }).on('error', function () {
        console.log('Caught exception: ' + err);
    });

}

function getDetailedActivities(athleteId, serverActivityIds) {
    var query = "SELECT * FROM detailedactivity " +
                "WHERE athleteId=?";
    db.query(
      query,
      [athleteId],
      function (err, rows) {
          if (err) throw err;
          console.log("getDetailedActivities invoked");
          console.log("return from query - rows length = " + rows.length);

          if (rows.length == 0) {
              console.log("no deTailed activities found for this athlete");
              // get activities from Strava server
          }
          else {
              // make a list of activities that came back from the Strava server that are not in the db

              // make an associative array of activities from the db, indexed by activityId
              // also, add each item from the db to the list of detailed activities that will be returned by the server.
              dbActivities = {};
              detailedActivitiesToReturn = [];
              for (var i in rows) {
                  dbActivities[rows[i].activityId] = rows[i];
                  detailedActivitiesToReturn.push(rows[i]);
              }

              // compare to activities returned from server (activityIds)
              for (var i in serverActivityIds) {
                  activityId = serverActivityIds[i];
                  if (!(activityId in dbActivities)) {
                      detailedActivityIdsToFetch.push(activityId);
                  }
              }

              console.log("detailedActivityIdsToFetch = ");
              console.log(detailedActivityIdsToFetch);

              // start getting items from the server
              if (detailedActivityIdsToFetch.length == 0) {
                  // don't need to fetch any more from server, return the current list
                  sendActivitiesResponse();
              }
              else {
                  console.log("number of activities is " + detailedActivityIdsToFetch.length);
                  activityId = detailedActivityIdsToFetch.shift();
                  console.log("grabbed first activityId");
                  console.log("initial activity id is " + activityId);
                  getDetailedActivityData(activityId);
              }
          }
      }
    );
}

var activitiesResponse;

function getAuthenticatedAthlete(responseData, nextFunction) {

    athleteId = responseData.athleteId;
    console.log("getAuthenticatedAthlete invoked, athleteId = " + athleteId);

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
              return;
              // to do - redirect user back to connect page
          }
          else {
              //console.log("The following row was returned from the db");
              //console.log(rows[0]);

              var accessToken = rows[0].authorizationKey;
              console.log("retrieved accessToken " + accessToken);
              responseData.accessToken = accessToken;

              // response successful, invoke next function
              nextFunction(responseData);
          }
      }
    );
}

function convertDetailedActivity(detailedActivity) {

    convertedActivity = {};
    convertedActivity.activityId = detailedActivity.id.toString();
    convertedActivity.athleteId = detailedActivity.athlete.id.toString();
    convertedActivity.name = detailedActivity.name;
    convertedActivity.description = detailedActivity.description;
    convertedActivity.distance = detailedActivity.distance * 0.000621371;
    convertedActivity.movingTime = detailedActivity.moving_time;
    convertedActivity.elapsedTime = detailedActivity.elapsed_time;
    convertedActivity.totalElevationGain = Math.floor(detailedActivity.total_elevation_gain * 3.28084);
    convertedActivity.averageSpeed = detailedActivity.average_speed * 2.23694;
    convertedActivity.maxSpeed = detailedActivity.max_speed * 2.23694;
    convertedActivity.calories = detailedActivity.calories;
    convertedActivity.startDateTime = getMySqlDateTime(detailedActivity.start_date_local);
    return convertedActivity;

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
      }
    );
}


function addSummaryActivitiesToDB(responseData, summaryActivitiesFromStrava, summaryActivitiesToStoreInDB) {

    console.log("addSummaryActivitiesToDB invoked");

    for (var key in summaryActivitiesToStoreInDB) {
        console.log("add summary activity with id " + key + " to the database");
        //console.log(summaryActivitiesToStoreInDB[key]);
        addSummaryActivityToDB(summaryActivitiesToStoreInDB[key]);
    }

}

function fetchDetailedActivity(activityId) {

    console.log("fetchDetailedActivity invoked with activityId = " + activityId);

    var options = {
        host: 'www.strava.com',
        path: '/api/v3/activities/' + activityId.toString(),
        port: 443,
        headers: {
            'Authorization': 'Bearer ' + responseData.accessToken
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

            // convert string from server into JSON object
            detailedActivityData = JSON.parse(str);
            console.log(detailedActivityData);

            // retrieve segment effort ids (and segment id's?) from detailed activity

            // add detailed activity to the database
            // add segment effort ids (and segment id's?) to the db

        });

    }).on('error', function () {
        console.log('Caught exception: ' + err);
    });
}

function fetchDetailedActivitiesFromStrava(responseData, detailedActivityIdsToFetchFromServer) {

    console.log("fetchDetailedActivitiesFromStrava invoked");
    console.log(detailedActivityIdsToFetchFromServer);

    var idsOfActivitiesFetchedFromStrava = [];

    for (var key in detailedActivityIdsToFetchFromServer) {

        activityId = detailedActivityIdsToFetchFromServer[key];

        var options = {
            host: 'www.strava.com',
            path: '/api/v3/activities/' + activityId.toString(),
            port: 443,
            headers: {
                'Authorization': 'Bearer ' + responseData.accessToken
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

                idsOfActivitiesFetchedFromStrava.push(activityId);

                // convert string from server into JSON object
                detailedActivityData = JSON.parse(str);
                console.log(detailedActivityData);

                // might not be in the right format
                convertedActivity = convertDetailedActivity(detailedActivityData);
                responseData.detailedActivitiesToReturn.push(convertedActivity);

                // retrieve segment effort ids (and segment id's?) from detailed activity

                // add detailed activity to the database
                // add segment effort ids (and segment id's?) to the db

                if (idsOfActivitiesFetchedFromStrava.length == Object.keys(detailedActivityIdsToFetchFromServer).length) {
                    console.log("all detailed activities fetched from strava");
                    sendActivitiesResponse(responseData.serverResponse, responseData.detailedActivitiesToReturn);
                    return;
                }
            });

        }).on('error', function () {
            console.log('Caught exception: ' + err);
        });

    }
}

function getDetailedActivitiesInDB(responseData, summaryActivitiesFromStrava) {

    console.log("getDetailedActivitiesInDB invoked");

    var detailedActivitiesInDB = {};

    var queryWhere = "WHERE activityId in (";
    var activityIds = [];

    var ch = '';
    summaryActivitiesFromStrava.forEach(buildQuery);

    function buildQuery(activity, index, array) {

        queryWhere += ch + "?";
        ch = ',';

        activityIds.push(activity.id.toString());
    };
    queryWhere += ")";

    console.log(queryWhere);
    console.log(activityIds);

    var query = "SELECT * FROM detailedactivity " + queryWhere;

    db.query(
      query,
      activityIds,
      function (err, rows) {

        if (err) throw err;

        console.log("num rows = " + rows.length);

        // store the activity id's of those activities found in the database
        for (var i in rows) {
            detailedActivitiesInDB[rows[i].activityId] = rows[i].activityId;
        }

        // create a list of all summary activities that came from the server - we'll fetch detailed versions of a subset of these from the server
        var detailedActivitiesToFetchFromServer = {};
        //for (i = 0; i < summaryActivitiesFromStrava.length; i++) {
        for (var i in summaryActivitiesFromStrava) {
            detailedActivitiesToFetchFromServer[summaryActivitiesFromStrava[i].id] = summaryActivitiesFromStrava[i].id;
        }

        // remove those items from the list that are already in the database
        for (var key in detailedActivitiesToFetchFromServer) {
            if (detailedActivitiesInDB.hasOwnProperty(key)) {
                delete detailedActivitiesToFetchFromServer[key];
            }
        }
        
        // the response we send back should include all the detailed activities retrieved from the db
        responseData.detailedActivitiesToReturn = [];
        for (var i in rows) {
            responseData.detailedActivitiesToReturn.push(rows[i]);
        }

        // the remaining items in detailedActivitiesToFetchFromServer need to be fetched from the strava server (as detailed activities)
        fetchDetailedActivitiesFromStrava(responseData, detailedActivitiesToFetchFromServer);
      });
}

function getSummaryActivitiesFromStrava(responseData) {

    console.log("getSummaryActivitiesFromStrava invoked");

    var options = {
        host: 'www.strava.com',
        path: '/api/v3/athlete/activities',
        port: 443,
        headers: {
            'Authorization': 'Bearer ' + responseData.accessToken
        }
    };

    var summaryActivitiesStr = "";

    https.get(options, function (res) {

        res.on('data', function (d) {
            console.log("chunk received");
            summaryActivitiesStr += d;
        });
        res.on('end', function () {
            console.log("end received");

            var summaryActivities = JSON.parse(summaryActivitiesStr);

            console.log("summaryActivities retrieved");

            //console.log("summaryActivities");
            //console.log(summaryActivities);

            // summary activities have been retrieved - next step, add any summaryActivities that are not already in the db to the db
            getDetailedActivitiesInDB(responseData, summaryActivities);
        });

    }).on('error', function () {
        console.log('Caught exception: ' + err);
    });
}

function listAthleteActivitiesNewest(responseData) {
    console.log('listAthleteActivitiesNewest invoked');
    console.log('athleteId=', responseData.athleteId);
    getAuthenticatedAthlete(responseData, getSummaryActivitiesFromStrava);
}

function listAthleteActivitiesNew(response, athleteId) {

    console.log('listAthleteActivities invoked');
    console.log('athleteId=', athleteId);

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

              var accessToken = rows[0].authorizationKey;
              console.log("retrieved accessToken " + accessToken);


              var options = {
                  host: 'www.strava.com',
                  path: '/api/v3/athlete/activities',
                  port: 443,
                  headers: {
                      'Authorization': 'Bearer ' + accessToken
                  }
              };

              var activitiesStr = ""

              https.get(options, function (res) {

                  res.on('data', function (d) {
                      console.log("chunk received");
                      activitiesStr += d;
                  });
                  res.on('end', function () {
                      console.log("end received");

                      var activities = JSON.parse(activitiesStr);
                      var athleteDetailedActivities = [];

                      // create a list of activity id's retrieved from Strava server
                      function fetchActivity(activity, index, array) {

                          console.log("fetchActivity invoked with id = " + activity.id + ", accessToken = " + accessToken);

                          var options = {
                              host: 'www.strava.com',
                              path: '/api/v3/activities/' + activity.id.toString(),
                              port: 443,
                              headers: {
                                  'Authorization': 'Bearer ' + accessToken
                              }
                          };

                          var detailedActivityStr = ""

                          https.get(options, function (res) {
                              //console.log('STATUS: ' + res.statusCode);
                              //console.log('HEADERS: ' + JSON.stringify(res.headers));

                              res.on('data', function (d) {
                                  console.log("chunk received for activity id = " + activity.id);
                                  detailedActivityStr += d;
                              });
                              res.on('end', function () {
                                  console.log("end received for activity id = " + activity.id);
                                  //console.log(str);

                                  var myDetailedActivityData = JSON.parse(detailedActivityStr);
                                  athleteDetailedActivities.push(myDetailedActivityData);
                              });

                          }).on('error', function () {
                              console.log('Caught exception: ' + err);
                          });
                      }
                      activities.forEach(fetchActivity);

                      // compare to list of activities in the database for the current athlete
                  });

              }).on('error', function () {
                  console.log('Caught exception: ' + err);
              });

          }
      }
    );
}

// get a list of activities for the authenticated user
function listAthleteActivities(response, athleteId) {

    activitiesResponse = response;

    console.log('listAthleteActivities invoked');
    console.log('athleteId=', athleteId);

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

              // todo? - check that the accessToken hasn't changed from what is stored in the db. If it has, update the db?

              var options = {
                  host: 'www.strava.com',
                  path: '/api/v3/athlete/activities',
                  port: 443,
                  headers: {
                      'Authorization': 'Bearer ' + accessToken
                  }
              };

              var str = ""

              var serverActivityIds = [];

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

                      // create a list of activity id's retrieved from Strava server
                      function saveActivity(activity, index, array) {
                          serverActivityIds.push(activity.id);
                      }
                      activities.forEach(saveActivity);

                      // compare to list of activities in the database for the current athlete
                      getDetailedActivities(athleteId, serverActivityIds);
                  });

              }).on('error', function () {
                  console.log('Caught exception: ' + err);
              });
          }
      }
    );
}

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

    // post token to Strava server; get back access token
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

function send404(response) {
    response.writeHead(404, { 'Content-Type': 'text/plain' });
    response.write('Error 404: resource not found.');
    response.end();
}

function sendFile(response, filePath, fileContents) {
    response.writeHead(
      200,
      { "content-type": mime.lookup(path.basename(filePath)) }
    );
    response.end(fileContents);
}

function serveStatic(response, cache, absPath) {
    if (cache[absPath]) {
        sendFile(response, absPath, cache[absPath]);
    } else {
        fs.exists(absPath, function (exists) {
            if (exists) {
                fs.readFile(absPath, function (err, data) {
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

function sendActivitiesResponse(response, activitiesAsJson) {
    response.writeHead(
    200,
    { "content-type": 'application/json' }
    );
    response.end(JSON.stringify(activitiesAsJson, null, 3));
}


var globalCounter = 0;
var requestCounter = 0;

console.log('begin execution: global counter = ' + globalCounter.toString());
globalCounter++;

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

    console.log('begin execution: request counter = ' + requestCounter.toString());
    requestCounter++;

    var responseData = {};
    responseData.serverResponse = response;

    var filePath = false;

    parsedUrl = url.parse(request.url, true);
    console.log(request.url);
    console.log(parsedUrl.pathname);
    console.log(parsedUrl.query);

    if (parsedUrl.pathname == '/StravaStatsHome.html') {                  // complete authentication
        console.log("StravaStatsHome invoked");
        console.log("query is ");
        console.log(parsedUrl.query);
        performTokenExchange(response, parsedUrl.query.code);
        return;
    }
    else if (parsedUrl.pathname == '/listAthleteActivities.html') {          // web service call
        //listAthleteActivities(response, parsedUrl.query.athleteId);
        //listAthleteActivitiesNew(response, parsedUrl.query.athleteId);
        responseData.athleteId = parsedUrl.query.athleteId;
        listAthleteActivitiesNewest(responseData);
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


