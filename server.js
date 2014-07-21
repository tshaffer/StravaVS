var http = require('http');
var https = require('https');
var fs = require('fs');
var path = require('path');
var mime = require('mime');
var url = require('url');
var mysql = require('mysql');

var cache = {};

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

// invoked after authentication when user requests details about an individual activity
function getEfforts(responseData) {
    console.log("getEfforts invoked");

    responseData.detailedEffortsStruct = {};
    responseData.segmentEffortStruct = {};
    responseData.segmentStruct = {};

    // retrieve a list of segment effort ids for this specific activity (get segment id's as well)
    var query = "SELECT * FROM segmenteffortids " +
                "WHERE activityId=?";
    db.query(
      query,
      [responseData.activityId],
      function (err, rows) {
          if (err) throw err;
          console.log("getEfforts query returned");
          console.log("return from query - rows length = " + rows.length);

          // create a list of all segment id's associated with this activity - we'll fetch a subset of these from Strava
          responseData.segmentIdsToFetchFromStrava = {};
          responseData.idsOfSegmentFetchedFromStrava = [];

          // create a list of all segment effort id's associated with this activity - we'll fetch a subset of these from Strava
          responseData.segmentEffortIdsToFetchFromStrava = {};
          responseData.idsOfSegmentEffortsFetchedFromStrava = [];

          // for each segment effort associated with this activity, add relevant info to struct
          // key is 
          //    segmentEffortId
          // value is AA with the following members:
          //    segmentId
          //    segmentEffort

          for (var i in rows) {
              segmentEffortValue = {};
              segmentEffortValue.segmentId = rows[i].segmentId;
              segmentEffortValue.segmentEffort = null;
              responseData.segmentEffortStruct[rows[i].segmentEffortId] = segmentEffortValue;

              responseData.segmentStruct[rows[i].segmentId] = null;

              responseData.segmentEffortIdsToFetchFromStrava[rows[i].segmentEffortId] = rows[i].segmentEffortId;
              responseData.segmentIdsToFetchFromStrava[rows[i].segmentId] = rows[i].segmentId;
          }

          fetchSegmentsFromDB(responseData);

          fetchSegmentEffortsFromDB(responseData);
      }
    );
}

function detailedEffortFetchesComplete(responseData) {
    if (responseData.idsOfSegmentEffortsFetchedFromStrava.length == Object.keys(responseData.segmentEffortIdsToFetchFromStrava).length &&
        responseData.idsOfSegmentFetchedFromStrava.length == Object.keys(responseData.segmentIdsToFetchFromStrava).length) {
        return true;
    }
    return false;
}

function fetchSegmentEffortsFromDB(responseData) {

    console.log("fetchSegmentEffortsFromDB invoked");

    // build query to determine which of the segment efforts are already in the database
    var queryWhere = "WHERE segmentEffortId in (";
    var segmentEffortIds = [];
    var ch = '';

    for (var key in responseData.segmentEffortStruct) {
        if (responseData.segmentEffortStruct.hasOwnProperty(key)) {
            queryWhere += ch + "?";
            ch = ',';
            segmentEffortIds.push(key);
        }
    }

    queryWhere += ")";

    var query = "SELECT * FROM segmenteffort " + queryWhere;

    //console.log("segmentEffortIds is " + responseData.segmentEffortIdsToFetchFromStrava);

    db.query(
      query,
      segmentEffortIds,
      function (err, rows) {

          // save segment effort data
          // remove this segment effort id from list of segment efforts to retrieve from server
          for (var i in rows) {
              responseData.segmentEffortStruct[rows[i].segmentEffortId].segmentEffort = rows[i];
              delete responseData.segmentEffortIdsToFetchFromStrava[rows[i].segmentEffortId];
          }

          // responseData.segmentEffortIdsToFetchFromStrava now reflects the complete list of segment efforts to retrieve
          console.log("fetchSegmentEffortsFromDB: number of segments efforts to fetch from strava is: " + Object.keys(responseData.segmentEffortIdsToFetchFromStrava).length);
          //console.log(responseData.segmentEffortStruct);

          // the remaining items in segmentEffortIdsToFetchFromStrava need to be fetched from strava (as segment efforts)
          if (Object.keys(responseData.segmentEffortIdsToFetchFromStrava).length == 0) {
              if (detailedEffortFetchesComplete(responseData)) {
                  sendDetailedEffortsResponse(responseData);
              }
          }
          else {
              fetchSegmentEffortsFromStrava(responseData);
          }
      }
    );
}

function fetchSegmentsFromDB(responseData) {

    console.log("fetchSegmentsFromDB invoked");

    // build query to determine which of the segments are already in the database
    var queryWhere = "WHERE segmentId in (";

    var ch = '';
    var segmentIdsToFetchFromStrava = [];

    for (var segmentId in responseData.segmentIdsToFetchFromStrava) {
        if (responseData.segmentIdsToFetchFromStrava.hasOwnProperty(segmentId)) {
            queryWhere += ch + "?";
            ch = ',';
            segmentIdsToFetchFromStrava.push(segmentId);
        }
    }
          
    queryWhere += ")";
          
    var query = "SELECT * FROM segment " + queryWhere;

    db.query(
      query,
      segmentIdsToFetchFromStrava,
      function (err, rows) {

          // save segment data
          // remove this segment from list of segments to retrieve from server
          for (var i in rows) {
              responseData.segmentStruct[rows[i].segmentId] = rows[i];
              delete responseData.segmentIdsToFetchFromStrava[rows[i].segmentId];
          }

          // responseData.segmentIdsToFetchFromStrava now reflects the complete list of segments to retrieve
          console.log("fetchSegmentsFromDB: number of segments to fetch from strava is: " + Object.keys(responseData.segmentIdsToFetchFromStrava).length);
          //console.log(responseData.segmentStruct);

          // the remaining items in segmentIdsToFetchFromStrava need to be fetched from strava (as segments)
          if (Object.keys(responseData.segmentIdsToFetchFromStrava).length == 0) {
              if (detailedEffortFetchesComplete(responseData)) {
                  sendDetailedEffortsResponse(responseData);
              }
          }
          else {
              fetchSegmentsFromStrava(responseData);
          }
      }
    );
}

function fetchSegmentsFromStrava(responseData) {
    console.log("fetchSegmentsFromStrava invoked");
    console.log(responseData.segmentIdsToFetchFromStrava);

    for (var key in responseData.segmentIdsToFetchFromStrava) {

        segmentId = responseData.segmentIdsToFetchFromStrava[key];
        fetchSegmentFromStrava(responseData, segmentId);
    }

}

function fetchSegmentFromStrava(responseData, segmentId) {

    console.log("invoked fetchSegmentFromStrava, id = " + segmentId);

    var options = {
        host: 'www.strava.com',
        path: '/api/v3/segments/' + segmentId.toString(),
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
            str += d;

            console.log("chunk received for segmentId = " + segmentId);

        });
        res.on('end', function () {
            console.log("end received for segmentId = " + segmentId);

            segment = JSON.parse(str);

            // segment  received - add to db, structure
            convertedSegment = addSegmentToDB(segment);

            console.log("convertedSegment = ");
            console.log(convertedSegment);

            // segment is the raw data from the server; need to convert it before adding it to the server
            responseData.segmentStruct[segmentId] = convertedSegment;

            responseData.idsOfSegmentFetchedFromStrava.push(segmentId);

            if (detailedEffortFetchesComplete(responseData)) {
                console.log("fetchSegmentFromStrava: all segment efforts and segments retrieved");
                sendDetailedEffortsResponse(responseData);
            }
        });
    });

}

function fetchSegmentEffortsFromStrava(responseData) {

    console.log("fetchSegmentEffortsFromStrava invoked");
    console.log(responseData.segmentEffortIdsToFetchFromStrava);

    for (var key in responseData.segmentEffortIdsToFetchFromStrava) {

        segmentEffortId = responseData.segmentEffortIdsToFetchFromStrava[key];
        console.log("invoke fetchSegmentEffortFromStrava with id " + segmentEffortId);
        fetchSegmentEffortFromStrava(responseData, segmentEffortId);
    }
}

function fetchSegmentEffortFromStrava(responseData, segmentEffortId) {

    console.log("invoked fetchSegmentEffortFromStrava, id = " + segmentEffortId);

    var options = {
        host: 'www.strava.com',
        path: '/api/v3/segment_efforts/' + segmentEffortId.toString(),
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
            str += d;

            console.log("chunk received for segmentEffortId = " + segmentEffortId);

        });
        res.on('end', function () {
            console.log("end received for segmentEffortId = " + segmentEffortId);

            segmentEffort = JSON.parse(str);

            console.log("segmentId = " + segmentEffort.segment.id);

            convertedSegmentEffort = addSegmentEffortToDB(segmentEffort);

            console.log("convertedSegmentEffort = ");
            console.log(convertedSegmentEffort);

            responseData.segmentEffortStruct[segmentEffortId].segmentEffort = convertedSegmentEffort;

            responseData.idsOfSegmentEffortsFetchedFromStrava.push(segmentEffortId);
            
            if (detailedEffortFetchesComplete(responseData)) {
                console.log("fetchSegmentEffortFromStrava: all segment efforts and segments retrieved");
                sendDetailedEffortsResponse(responseData);
            }
        });
    });
}

// get detailed activity
// data to return to client includes my version of segmentEfforts that also includes a portion of segment data
function getActivityEfforts(responseData) {
    console.log('getActivityEfforts invoked, id = ' + responseData.activityId);
    getAuthenticatedAthlete(responseData, getEfforts);
}

function addSegmentToDB(segment) {

    segmentId = segment.id.toString();
    name = segment.name;
    distance = segment.distance * 0.000621371;
    averageGrade = segment.average_grade;
    maxGrade = segment.maximum_grade;
    totalElevationGain = segment.total_elevation_gain * 3.28084;

    db.query(
        "INSERT INTO segment (segmentId, name, distance, averageGrade, maxGrade, totalElevationGain) " +
        " VALUES (?, ?, ?, ?, ?, ?)",
        [segmentId, name, distance, averageGrade, maxGrade, totalElevationGain],
        function (err) {
            //if (err) throw err;
            if (err) {
                console.log("db error in addSegmentToDB");
            }
            else {
                console.log("added segment successfully");
            }
        }
    );

    return { "segmentId": segmentId, "name": name, "distance": distance, "averageGrade": averageGrade, "maxGrade": maxGrade, "totalElevationGain": totalElevationGain };

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
      }
    );

    return { "segmentEffortId": segmentEffortId, "name": name, "movingTime": movingTime, "elapsedTime": elapsedTime, "startDateTime": startDateTime, "distance": distance };

}

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
    if (!description) {
        description = "";
    }
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

function fetchDetailedActivityFromStrava(responseData, detailedActivityIdToFetchFromServer, detailedActivityIdsToFetchFromServer, idsOfActivitiesFetchedFromStrava) {

    var options = {
        host: 'www.strava.com',
        path: '/api/v3/activities/' + detailedActivityIdToFetchFromServer.toString(),
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
            str += d;

            console.log("chunk received for detailedActivityIdToFetchFromServer = " + detailedActivityIdToFetchFromServer);

        });
        res.on('end', function () {
            console.log("end received for detailedActivityIdToFetchFromServer = " + detailedActivityIdToFetchFromServer);

            idsOfActivitiesFetchedFromStrava.push(detailedActivityIdToFetchFromServer);

            // convert string from server into JSON object
            detailedActivityData = JSON.parse(str);
            //console.log(detailedActivityData);

            // convert from Strava JSON format into the format digestible by the db
            convertedActivity = convertDetailedActivity(detailedActivityData);
            responseData.detailedActivitiesToReturn.push(convertedActivity);

            // retrieve segment effort ids (and segment id's?) from detailed activity
            segmentEfforts = detailedActivityData.segment_efforts;
            console.log("number of segment efforts for this activity is " + segmentEfforts.length);

            segmentEfforts.forEach(addSegmentEffortIdToDB);
            function addSegmentEffortIdToDB(segmentEffort, index, array) {
                //console.log("add segmentEffort id " + segmentEffort.id + ", activity id = " + detailedActivityIdToFetchFromServer + ", segment id = " + segmentEffort.segment.id);
                db.query(
                  "INSERT INTO segmenteffortids (segmentEffortId, activityId, segmentId) " +
                  " VALUES (?, ?, ?)",
                  [segmentEffort.id.toString(), detailedActivityIdToFetchFromServer.toString(), segmentEffort.segment.id.toString()],
                  function (err) {
                      //if (err) throw err;
                      if (err) {
                          console.log("error adding segmenteffortid to db");
                      }
                  }
                );
            };

            // add detailed activity to the database
            addDetailedActivityToDB(detailedActivityData);

            console.log("check for completion");
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

function fetchDetailedActivitiesFromStrava(responseData, detailedActivityIdsToFetchFromServer) {

    console.log("fetchDetailedActivitiesFromStrava invoked");
    console.log(detailedActivityIdsToFetchFromServer);

    var idsOfActivitiesFetchedFromStrava = [];

    for (var key in detailedActivityIdsToFetchFromServer) {

        activityId = detailedActivityIdsToFetchFromServer[key];
        console.log("invoke fetchDetailedActivityFromStrava with id " + activityId);
        fetchDetailedActivityFromStrava(responseData, activityId, detailedActivityIdsToFetchFromServer, idsOfActivitiesFetchedFromStrava);
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
          // if there are none, send the response now
        if (Object.keys(detailedActivitiesToFetchFromServer).length == 0) {
            sendActivitiesResponse(responseData.serverResponse, responseData.detailedActivitiesToReturn);
        }
        else {
            fetchDetailedActivitiesFromStrava(responseData, detailedActivitiesToFetchFromServer);
        }
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

// get a list of activities for the authenticated user
function listAthleteActivities(responseData) {
    console.log('listAthleteActivities invoked');
    console.log('athleteId=', responseData.athleteId);
    getAuthenticatedAthlete(responseData, getSummaryActivitiesFromStrava);
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

function sendDetailedEffortsResponse(responseData) {
    console.log("sendDetailedEffortsResponse invoked");

    var detailedActivity = {};
    detailedActivity.name = responseData.activityName;
    detailedActivity.detailedEfforts = [];

    for (var segmentEffortId in responseData.segmentEffortStruct) {
        if (responseData.segmentEffortStruct.hasOwnProperty(segmentEffortId)) {
            segmentEffortValue = responseData.segmentEffortStruct[segmentEffortId];
            console.log("segmentEffortValue");
            console.log(segmentEffortValue);

            // retrieve segment effort data
            segmentEffort = segmentEffortValue.segmentEffort;

            // retrieve corresponding segment data
            segmentId = segmentEffortValue.segmentId;
            console.log("segmentId = " + segmentId);

            segment = responseData.segmentStruct[segmentId];

            detailedEffort = {};

            console.log(segment);

            // segment data
            detailedEffort.segmentId = segment.segmentId;
            detailedEffort.segmentName = segment.name;
            detailedEffort.segmentDistance = segment.distance;
            detailedEffort.averageGrade = segment.averageGrade;
            detailedEffort.maxGrade = segment.maxGrade;
            detailedEffort.totalElevationGain = segment.totalElevationGain;

            // segment effort data
            detailedEffort.segmentEffortId = segmentEffort.segmentEffortId;
            detailedEffort.segmentEffortName = segmentEffort.name;
            detailedEffort.movingTime = segmentEffort.movingTime;
            detailedEffort.elapsedTime = segmentEffort.elapsedTime;
            detailedEffort.startDateTime = segmentEffort.startDateTime;
            detailedEffort.segmentEffortDistance = segmentEffort.distance;

            detailedActivity.detailedEfforts.push(detailedEffort);
        }
    }

    console.log(detailedActivity);

    responseData.serverResponse.writeHead(
    200,
    { "content-type": 'application/json' }
    );
    responseData.serverResponse.end(JSON.stringify(detailedActivity, null, 3));

}

function initDB() {

    console.log('create connection');

    db = mysql.createConnection({
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
      "CREATE TABLE IF NOT EXISTS segmenteffortids ("
      + "segmentEffortId VARCHAR(32) NOT NULL, "
      + "activityId VARCHAR(32) NOT NULL, "
      + "segmentId VARCHAR(32) NOT NULL, "
      + "PRIMARY KEY(segmentEffortId))",
      function (err) {
          if (err) throw err;
          console.log("create segmenteffortids successful");
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

    db.query(
      "CREATE TABLE IF NOT EXISTS segment ("
      + "segmentId VARCHAR(32) NOT NULL, "
      + "name VARCHAR(128) NOT NULL, "
      + "distance FLOAT NOT NULL, "
      + "averageGrade FLOAT NOT NULL, "
      + "maxGrade FLOAT NOT NULL, "
      + "totalElevationGain FLOAT NOT NULL, "
      + "PRIMARY KEY(segmentId))",
      function (err) {
          if (err) throw err;
          console.log("create segment successful");
          // note - should not proceed to createServer until this callback is executed
      }
    );
}

var globalCounter = 0;
var requestCounter = 0;
var db;

console.log('begin execution: global counter = ' + globalCounter.toString());
globalCounter++;

initDB();

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
        responseData.athleteId = parsedUrl.query.athleteId;
        listAthleteActivities(responseData);
        return;
    }
    else if (parsedUrl.pathname == '/getActivityEfforts.html') {       // web service call
        responseData.athleteId = parsedUrl.query.athleteId;
        responseData.activityId = parsedUrl.query.activityId;
        responseData.activityName = parsedUrl.query.activityName;
        getActivityEfforts(responseData);
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


