var dbHostName = '127.0.0.1';
//var dbHostName = 'stravadb.cohsjqy0hofx.us-west-1.rds.amazonaws.com';

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
    //console.log("jsDateTime = " + jsDateTime);

    // date conversion
    var year, month, day, hours, minutes, seconds;
    year = String(jsDateTime.getFullYear());
    month = String(jsDateTime.getMonth() + 1);
    if (month.length == 1) {
        month = "0" + month;
    }
    day = String(jsDateTime.getDate());
    if (day.length == 1) {
        day = "0" + day;
    }

    hours = String(jsDateTime.getHours());
    if (hours.length == 1) {
        hours = "0" + hours;
    }

    minutes = String(jsDateTime.getMinutes());
    if (minutes.length == 1) {
        minutes = "0" + minutes;
    }

    seconds = String(jsDateTime.getSeconds());
    if (seconds.length == 1) {
        seconds = "0" + seconds;
    }

    return year + "-" + month + "-" + day + " " + hours + ":" + minutes + ":" + seconds;
}

function getFriends(responseData) {

    console.log("invoked getFriends");

    var options = {
        host: 'www.strava.com',
        path: '/api/v3/athlete/friends',
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
        });
        res.on('end', function () {
            friends = JSON.parse(str);
            sendFriendsResponse(responseData, friends);
        });
    });

}

function getBestTimes(responseData, segmentIds) {

    var numRemainingQueries = segmentIds.length;

    var bestTimesBySegment = {};

    segmentIds.forEach(getBestTime);
    function getBestTime(segmentId, index, array) {
        console.log("segmentId: " + segmentId);

        var query = "select min(segmenteffort.movingTime) as besttime from segmenteffortids, segmenteffort where segmenteffort.segmentEffortId = segmenteffortids.segmentEffortId and segmenteffortids.segmentId=?";
        db.query(
          query,
          [segmentId],
          function (err, rows) {
              if (err) throw err;
              //console.log("getBestEffort query returned");
              //console.log("return from query - rows length = " + rows.length);
              //console.log(rows[0]);
              //var bestTime = rows[0]['min(segmenteffort.movingTime)'];
              //console.log("bestTime: " + rows[0]["besttime"]);

              var bestTime = rows[0]["besttime"];
              console.log("bestTime for segmentId: " + segmentId + " is " + bestTime);

              bestTimesBySegment[segmentId] = bestTime;

              numRemainingQueries--;
              if (numRemainingQueries == 0) {
                  console.log("all bestTimes retrieved");
                  sendBestTimesResponse(responseData.serverResponse, bestTimesBySegment);
              }
          });
    };
}

// get segment efforts for a friend or authenticated athlete
function allEfforts(responseData) {

    segmentId = responseData.segmentId;
    athleteId = responseData.friendId;

    console.log('allEfforts invoked, segmentId = ' + segmentId + ', athleteId = ' + athleteId);

    var options = {
        host: 'www.strava.com',
        path: '/api/v3/segments/' + segmentId.toString() + '/all_efforts?athlete_id=' + athleteId.toString(),
        port: 443,
        headers: {
            'Authorization': 'Bearer ' + responseData.accessToken
        }
    };

    console.log("complete url is " + options.host + options.path);

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

            data = JSON.parse(str);

            responseData.serverResponse.writeHead(
                200,
                { "content-type": 'application/json' }
                );
            responseData.serverResponse.end(JSON.stringify(data, null, 3));
        });

    }).on('error', function () {
        console.log('Caught exception: ' + err);
    });
}

// invoked after authentication when user requests details about an individual activity
function getIndividualEfforts(responseData) {
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

function getEfforts(responseData) {
    console.log("getEfforts invoked");

    responseData.segmentEffortStruct = {};
    responseData.segmentStruct = {};

    var nameQuery = "SELECT name FROM detailedactivity " +
                    "WHERE activityId=?";
    db.query(
      nameQuery,
      [responseData.activityId],
      function (err, rows) {
          if (err) throw err;
          console.log("nameQuery returned");
          console.log("return from query - rows length = " + rows.length);

          if (rows.length > 0) {
              console.log(rows[0]);
              console.log("name: " + rows[0].name);
              responseData.activityName = rows[0].name;
          }

          getIndividualEfforts(responseData);
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

function fetchSegmentFromDB(responseData) {
    console.log("fetchSegmentFromDB invoked");

    var query = "SELECT * FROM segment WHERE segmentId=?";

    db.query(
      query,
      [responseData.segmentId],
      function (err, rows) {
          if (err) throw err;
          console.log("fetchSegmentFromDB query returned");
          console.log("return from query - rows length = " + rows.length);

          if (rows.length == 1) {
              responseData.rawSegmentData = rows[0];
          }

          sendSegmentResponse(responseData);
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

            //console.log("convertedSegment = ");
            //console.log(convertedSegment);

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

            //console.log("convertedSegmentEffort = ");
            //console.log(convertedSegmentEffort);

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
function getDetailedActivity(responseData) {

    console.log('getDetailedActivity invoked');
    console.log('activityId = ' + responseData.activityId);

    // initial implementation - retrieve activity from db; not strava
    var query = "SELECT * FROM detailedactivity WHERE activityId=?";

    db.query(
      query,
      [responseData.activityId],
      function (err, rows) {
          if (err) throw err;
          console.log("getDetailedActivity query returned");
          console.log("return from query - rows length = " + rows.length);

          if (rows.length == 1) {
              sendDetailedActivityResponse(responseData.serverResponse, rows[0]);
          }
          // else??
      }
    );
}

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
    startDateTime = getMySqlDateTime(segmentEffort.start_date);
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

              responseData.athlete = {};
              responseData.athlete.id = athleteId;
              //responseData.athlete.name = rows[0].athleteId;
              responseData.athlete.firstName = rows[0].firstname;
              responseData.athlete.lastName = rows[0].lastname;
              responseData.athlete.email = rows[0].email;

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
    //convertedActivity.startDateTime = getMySqlDateTime(detailedActivity.start_date_local);
    convertedActivity.startDateTime = getMySqlDateTime(detailedActivity.start_date);
    convertedActivity.startPointLatitude = detailedActivity.start_latitude;
    console.log("convertedActivity.startPointLatitude=" + convertedActivity.startPointLatitude);
    convertedActivity.startPointLongitude = detailedActivity.start_longitude;
    convertedActivity.mapPolyline = detailedActivity.map.polyline;
    convertedActivity.stream = detailedActivity.stream;
    return convertedActivity;

}

function addDetailedActivityToDB(detailedActivity) {

    var activityId = detailedActivity.id.toString();
    var athleteId = detailedActivity.athlete.id.toString();
    var name = detailedActivity.name;
    var description = detailedActivity.description;
    if (!description) {
        description = "";
    }
    var distance = detailedActivity.distance * 0.000621371;
    var movingTime = detailedActivity.moving_time;
    var elapsedTime = detailedActivity.elapsed_time;
    var totalElevationGain = Math.floor(detailedActivity.total_elevation_gain * 3.28084);
    var averageSpeed = detailedActivity.average_speed * 2.23694;
    var maxSpeed = detailedActivity.max_speed * 2.23694;
    var calories = detailedActivity.calories;
    var startDateTime = getMySqlDateTime(detailedActivity.start_date);
    //console.log("mySql datetime = " + startDateTime);
    var startPointLatitude = detailedActivity.start_latitude;
    var startPointLongitude = detailedActivity.start_longitude;
    //var startPointLatitude = detailedActivity.startPointLatitude;
    //var startPointLongitude = detailedActivity.startPointLongitude;
    var mapPolyline = detailedActivity.map.polyline;
    var stream = detailedActivity.stream;

    console.log("startPointLatitude: " + startPointLatitude);

    db.query(
      "INSERT INTO detailedactivity (activityId, athleteId, name, description, distance, movingTime, elapsedTime, totalElevationGain, startDateTime, averageSpeed, maxSpeed, calories, startPointLatitude, startPointLongitude, mapPolyline, stream) " +
      " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [activityId, athleteId, name, description, distance, movingTime, elapsedTime, totalElevationGain, startDateTime, averageSpeed, maxSpeed, calories, startPointLatitude, startPointLongitude, mapPolyline, stream],
      function (err) {
          //console.log("detailedActivity = ");
          //console.log(detailedActivity);
          if (err) throw err;
          //if (err) {
          //    console.log("error adding detailed activity to db for activityId=" + activityId);
          //}
          console.log("added detailed activity successfully to db for activityId=" + activityId);
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

    var str = "";

    https.get(options, function (res) {
        //console.log('STATUS: ' + res.statusCode);
        //console.log('HEADERS: ' + JSON.stringify(res.headers));

        res.on('data', function (d) {
            str += d;

            console.log("chunk received for detailedActivityIdToFetchFromServer = " + detailedActivityIdToFetchFromServer);

        });
        res.on('end', function () {
            console.log("end received for detailedActivityIdToFetchFromServer = " + detailedActivityIdToFetchFromServer);

            // convert string from server into JSON object
            var detailedActivityData = JSON.parse(str);

            //console.log("detailedActivity received from server for id " + detailedActivityIdToFetchFromServer);
            //console.log(detailedActivityData);

            fetchStreamFromStrava(responseData, detailedActivityData, detailedActivityIdToFetchFromServer, detailedActivityIdsToFetchFromServer, idsOfActivitiesFetchedFromStrava);
        });

    }).on('error', function () {
        console.log('Caught exception: ' + err);
    });
}

function fetchStreamFromStrava(responseData, detailedActivityData, detailedActivityIdToFetchFromServer, detailedActivityIdsToFetchFromServer, idsOfActivitiesFetchedFromStrava) {

    var str = "";

    var options = {
        host: 'www.strava.com',
        path: '/api/v3/activities/' + detailedActivityIdToFetchFromServer.toString() + '/streams/time,latlng,distance,altitude,grade_smooth',
        port: 443,
        headers: {
            'Authorization': 'Bearer ' + responseData.accessToken
        }
    };

    https.get(options, function (streamResponse) {
        console.log('STATUS: ' + streamResponse.statusCode);
        console.log('HEADERS: ' + JSON.stringify(streamResponse.headers));

        streamResponse.on('data', function (d) {
            str += d;
            console.log("stream chunk received for detailedActivityIdToFetchFromServer = " + detailedActivityIdToFetchFromServer);
        });

        streamResponse.on('end', function () {
            console.log("end received for stream fetch of detailedActivityIdToFetchFromServer = " + detailedActivityIdToFetchFromServer);

            idsOfActivitiesFetchedFromStrava.push(detailedActivityIdToFetchFromServer);

            // what is the length of the stream?
            detailedActivityData.stream = str;
            console.log("length of stream string is: " + detailedActivityData.stream.length);

            // convert from Strava JSON format into the format digestible by the db
            var convertedActivity = convertDetailedActivity(detailedActivityData);
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
    });
}

function fetchDetailedActivitiesFromStrava(responseData, detailedActivityIdsToFetchFromServer) {

    console.log("fetchDetailedActivitiesFromStrava invoked");
    console.log(detailedActivityIdsToFetchFromServer);

    var idsOfActivitiesFetchedFromStrava = [];

    for (var key in detailedActivityIdsToFetchFromServer) {

        var activityId = detailedActivityIdsToFetchFromServer[key];
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
            authenticationData.athlete = {};
            authenticationData.athlete.firstname = data.athlete.firstname;
            authenticationData.athlete.lastname = data.athlete.lastname;
            authenticationData.athlete.email = data.athlete.email;

            console.log("the authentication data is");
            console.log(authenticationData);

            // add the authentication data to the data base if it's not already there

// is the use of the authentication data safe?

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
                        "INSERT INTO authenticatedathlete (athleteId, authorizationKey, firstname, lastname, email) " +
                        " VALUES (?, ?, ?, ?, ?)",
                        [authenticationData.athleteId.toString(), authenticationData.accessToken, authenticationData.athlete.firstname, authenticationData.athlete.lastname, authenticationData.athlete.email],
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

            insertAthleteInfo(response, authenticationData);

        });
    });

    req.on('error', function (e) {
        console.log('problem with request: ' + e.message);
    });

    // write data to request body
    req.write(postDataStr);
    req.end();
}

function insertAthleteInfo(response, authenticationData) {

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
                    console.log("replace athleteIdPlaceholder with " + authenticationData.athleteId);
                    console.log("type of athleteId is " + typeof authenticationData.athleteId);
                    var dataAsStr = String(data);
                    //console.log("search/replace string:");
                    //console.log(dataAsStr);
                    var finalDataAsStr = dataAsStr.replace("athleteIdPlaceholder", authenticationData.athleteId.toString());
                    finalDataAsStr = finalDataAsStr.replace("athleteNamePlaceholder", authenticationData.athlete.firstname + " " + authenticationData.athlete.lastname);
                    console.log(finalDataAsStr);
                    console.log("replaced athleteId = " + authenticationData.athleteId.toString());
                    sendFile(response, absPath, finalDataAsStr);
                }
            });
        } else {
            send404(response);
        }
    });

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

function sendBestTimesResponse(response, bestTimesBySegment) {
    response.writeHead(
    200,
    { "content-type": 'application/json' }
    );
    response.end(JSON.stringify(bestTimesBySegment, null, 3));
}

function sendActivitiesResponse(response, activitiesAsJson) {
    response.writeHead(
    200,
    { "content-type": 'application/json' }
    );
    response.end(JSON.stringify(activitiesAsJson, null, 3));
}

function sendDetailedActivityResponse(response, activityAsJson) {
    response.writeHead(
    200,
    { "content-type": 'application/json' }
    );
    response.end(JSON.stringify(activityAsJson, null, 3));
}

function sendSegmentResponse(responseData) {
    console.log("sendSegmentResponse invoked");

    var segment = {};
    segment.segmentId = responseData.rawSegmentData.segmentId;
    segment.segmentName = responseData.rawSegmentData.name;
    segment.segmentDistance = responseData.rawSegmentData.distance;
    segment.averageGrade = responseData.rawSegmentData.averageGrade;
    segment.maxGrade = responseData.rawSegmentData.maxGrade;
    segment.totalElevationGain = responseData.rawSegmentData.totalElevationGain;

    responseData.serverResponse.writeHead(
    200,
    { "content-type": 'application/json' }
    );
    responseData.serverResponse.end(JSON.stringify(segment, null, 3));

}

function sendDetailedEffortsResponse(responseData) {
    console.log("sendDetailedEffortsResponse invoked");

    var detailedActivity = {};
    detailedActivity.name = responseData.activityName;
    detailedActivity.detailedEfforts = [];

    for (var segmentEffortId in responseData.segmentEffortStruct) {
        if (responseData.segmentEffortStruct.hasOwnProperty(segmentEffortId)) {
            segmentEffortValue = responseData.segmentEffortStruct[segmentEffortId];
            //console.log("segmentEffortValue");
            //console.log(segmentEffortValue);

            // retrieve segment effort data
            segmentEffort = segmentEffortValue.segmentEffort;

            // retrieve corresponding segment data
            segmentId = segmentEffortValue.segmentId;
            console.log("segmentId = " + segmentId);

            segment = responseData.segmentStruct[segmentId];

            detailedEffort = {};

            //console.log(segment);

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

    //console.log(detailedActivity);

    responseData.serverResponse.writeHead(
    200,
    { "content-type": 'application/json' }
    );
    responseData.serverResponse.end(JSON.stringify(detailedActivity, null, 3));

}

function sendFriendsResponse(responseData, friends) {
    responseData.serverResponse.writeHead(
    200,
    { "content-type": 'application/json' }
    );
    responseData.serverResponse.end(JSON.stringify(friends, null, 3));
}

function initDB() {

    console.log('create connection');

    db = mysql.createConnection({
        host: dbHostName,
        //user: 'ted',
        //password: 'ted69',
        user: 'stravaTed',
        password: 'strava-69',
        database: 'strava'
    });

    console.log("connect");

    db.connect();

    db.query(
      "CREATE TABLE IF NOT EXISTS authenticatedathlete ("
      + "athleteId VARCHAR(32) NOT NULL, "
      + "authorizationKey VARCHAR(64) NOT NULL,"
      + "firstname VARCHAR(32) NOT NULL, "
      + "lastname VARCHAR(32) NOT NULL, "
      + "email VARCHAR(64) NOT NULL, "
      + "PRIMARY KEY(athleteId))",
      function (err) {
          if (err) throw err;
          console.log("create authenticatedAthlete successful");
          // note - should not proceed to createServer until this callback is executed
      }
    );

    db.query(
      "CREATE TABLE IF NOT EXISTS detailedactivity ("
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
      + "startPointLatitude DOUBLE NOT NULL, "
      + "startPointLongitude DOUBLE NOT NULL, "
      + "mapPolyline TEXT NOT NULL, "
      + "stream LONGTEXT NOT NULL, "
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

function initBikeTrailsDB() {

    console.log('create connection to bikeTrailsDB');

    bikeTrailsDB = mysql.createConnection({
        host: dbHostName,
        //user: 'ted',
        //password: 'ted69',
        user: 'stravaTed',
        password: 'strava-69',
        database: 'biketrails'
    });

    console.log("connect to bikeTrailsDB");

    bikeTrailsDB.connect();

    bikeTrailsDB.query(
      "CREATE TABLE IF NOT EXISTS trailarea ("
      + "id TINYINT NOT NULL AUTO_INCREMENT, "
      + "name VARCHAR(64) NOT NULL, "
      + "PRIMARY KEY(id))",
      function (err) {
          if (err) throw err;
          console.log("create trailarea successful");
          // note - should not proceed to createServer until this callback is executed
      }
    );

    bikeTrailsDB.query(
      "CREATE TABLE IF NOT EXISTS trail ("
      + "id SMALLINT NOT NULL AUTO_INCREMENT, "
      + "destinationTrailIntersection SMALLINT, "
      + "length FLOAT NOT NULL, "
      + "path LONGTEXT NOT NULL, "
      + "elevationGain FLOAT NOT NULL, "
      + "elevationGainReverseDirection FLOAT NOT NULL, "
      + "PRIMARY KEY(id))",
      function (err) {
          if (err) throw err;
          console.log("create trail successful");
          // note - should not proceed to createServer until this callback is executed
      }
    );

    bikeTrailsDB.query(
      "CREATE TABLE IF NOT EXISTS trailintersection ("
      + "id SMALLINT NOT NULL AUTO_INCREMENT, "
      + "name VARCHAR(64) NOT NULL, "
      + "elevation FLOAT NOT NULL, "
      + "originLatitude FLOAT NOT NULL, "
      + "originLongitude FLOAT NOT NULL, "
      + "PRIMARY KEY(id))",
      function (err) {
          if (err) throw err;
          console.log("create trail trailintersection");
          // note - should not proceed to createServer until this callback is executed
      }
    );

    bikeTrailsDB.query(
      "CREATE TABLE IF NOT EXISTS trailStartsAtTrailsIntersection  ("
      + "trailIntersectionId SMALLINT NOT NULL, "
      + "trailId SMALLINT NOT NULL, "
      + "PRIMARY KEY(trailIntersectionId))",
      function (err) {
          if (err) throw err;
          console.log("create trailStartsAtTrailsIntersection successful");
          // note - should not proceed to createServer until this callback is executed
      }
    );

}


var globalCounter = 0;
var requestCounter = 0;
var db;
var bikeTrailsDB;

console.log('begin execution: global counter = ' + globalCounter.toString());
globalCounter++;

initDB();

initBikeTrailsDB();

var server = http.createServer(function (request, response) {

    console.log('begin execution: request counter = ' + requestCounter.toString());
    requestCounter++;

    var responseData = {};
    responseData.serverResponse = response;

    var filePath = false;

    parsedUrl = url.parse(request.url, true);

    console.log("request url");
    console.log(request.url);
    console.log("parsed url pathname");
    console.log(parsedUrl.pathname);
    console.log("parsed url query");
    console.log(parsedUrl.query);

    if (parsedUrl.pathname == '/StravaStatsHome.html') {

        // browser is asking for the main app. this implies one of the following
        //      user is invoking the app by trying to connect to it - need to authenticate
        //      user is navigating to the app via the Back or Forward button
        //      user hits Refresh on the browser while in the app
        //      user goes to a Bookmark that points to the app

        console.log("StravaStatsHome invoked");

        if (parsedUrl.query.code != undefined) {
            console.log("query parameter 'code' exists - complete authentication");

            // user is invoking the app by trying to connect to it

            // complete authentication
            performTokenExchange(response, parsedUrl.query.code);
            return;
        }
        else {
            filePath = 'public/StravaStatsHome.html';
        }
    }
    else if (parsedUrl.pathname == '/athleteActivities') {
        responseData.athleteId = parsedUrl.query.athleteId;
        listAthleteActivities(responseData);
        return;
    }
    else if (parsedUrl.pathname == "/detailedActivity") {
        responseData.activityId = parsedUrl.query.activityId;
        responseData.athleteId = parsedUrl.query.athleteId;
        getAuthenticatedAthlete(responseData, getDetailedActivity);
        return;
    }
    else if (parsedUrl.pathname == '/activityEfforts') {
        responseData.athleteId = parsedUrl.query.athleteId;
        responseData.activityId = parsedUrl.query.activityId;
        //responseData.activityName = parsedUrl.query.activityName;
        getActivityEfforts(responseData);
        return;
    }
    else if (parsedUrl.pathname == '/segment') {
        responseData.athleteId = parsedUrl.query.athleteId;
        responseData.segmentId = parsedUrl.query.segmentId;
        getAuthenticatedAthlete(responseData, fetchSegmentFromDB);
        return;
    }
    else if (parsedUrl.pathname == '/allEfforts') {
        responseData.segmentId = parsedUrl.query.segment_id;
        responseData.athleteId = parsedUrl.query.athlete_id;
        responseData.friendId = parsedUrl.query.friend_id;
        getAuthenticatedAthlete(responseData, allEfforts);
        return;
    }
    else if (parsedUrl.pathname == '/friends') {
        responseData.athleteId = parsedUrl.query.athleteId;
        console.log("responseData.athleteId is " + responseData.athleteId);
        getAuthenticatedAthlete(responseData, getFriends);
        return;
    }
    else if (parsedUrl.pathname == '/bestTimes') {
        console.log("bestTimes, segmentIds are: ");
        console.log(parsedUrl.query["segmentIds[]"]);
        getBestTimes(responseData, parsedUrl.query["segmentIds[]"]);
        return;
    }
    else if (request.url == '/') {                                      // default to index.html
        filePath = 'public/index.html';
    } else {                                                            // serve static file
        parsedUrl = url.parse(request.url);
        filePath = "public" + parsedUrl.pathname;
    }
    var absPath = './' + filePath;
    console.log("absPath = " + absPath);
    serveStatic(response, cache, absPath);
});

server.listen(8080, function () {
    console.log("Server listening on port 8080.");
});


