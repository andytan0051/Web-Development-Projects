const express = require("express");
var pg = require("pg");
const dotenv = require("dotenv");
const {max} = require("pg/lib/defaults");

/* Reading global variables from config file */
dotenv.config();
const PORT = process.env.PORT;

const conString = process.env.DB_CON_STRING;

if (conString == undefined) {
    console.log("ERROR: environment variable DB_CON_STRING not set.");
    process.exit(1);
}

const dbConfig = {
    connectionString: conString,
    ssl: { rejectUnauthorized: false }
}

var dbClient = new pg.Client(dbConfig);
dbClient.connect();

/*
 *
 * Express setup
 *
*/

app = express();

//turn on serving static files (required for delivering css to client)
app.use(express.static("public"));
//configure template engine
app.set("views", "views");
app.set("view engine", "pug");

app.get('/', (req, res) => {
    res.render("index");
});

app.get('/stations', (req, res) => {

    var readingsArray = [];

    var index = 0;
    var i = 0;

    dbClient.query("SELECT * FROM stations JOIN readings ON stations.id = readings.station_id", function (dbError, dbResponse){
        dbClient.query("SELECT * FROM stations", function (dbError, dbStationResponse){
        while(index < dbStationResponse.rows.length){
            while(i < dbResponse.rows.length && dbResponse.rows[i].station_id === index+1){
                i++;
            }

            var readings = {
                location : undefined,
                weather : undefined,
                temperature : undefined,
                wind : undefined,
                pressure : undefined,
                stationid : undefined
            };
           // console.log(i);
           // console.log(dbResponse.rows[i-1].id);
            //console.log(dbResponse.rows[i-1].station);
            readings.location = dbResponse.rows[i-1].station;
            readings.weather = dbResponse.rows[i-1].weather;
            readings.temperature = dbResponse.rows[i-1].temperature;
            readings.wind = dbResponse.rows[i-1].wind;
            readings.pressure = dbResponse.rows[i-1].pressure;
            readings.stationid = dbResponse.rows[i-1].station_id;
            readingsArray.push(readings);
            //console.log(readingsArray[0].temperature);
            index++;
        }
       // console.log(readingsArray[2].stationid);

        res.render("dashboard", {
            latestreadings: readingsArray
        });
    });
    });

});

app.get("/stations/:id", function (req, res) {
    /* List details about a station */
    var stationId = req.params.id;

    dbClient.query("SELECT * FROM stations WHERE id=$1", [stationId], function (dbError, dbStationResponse) {
        dbClient.query("SELECT * FROM readings WHERE station_id=$1", [stationId], function (dbError, dbReadingsResponse) {
            if(dbReadingsResponse.rows.length == 0){
                res.render("error", {
                    error: "No data found"
                });
            }
            else {
                    res.render("details", {
                        station: dbStationResponse.rows[0],
                        latest_reading: dbReadingsResponse.rows[dbReadingsResponse.rows.length-1],
                        readings: dbReadingsResponse.rows.reverse()
                    });
            }
        });
    });

});


app.listen(PORT, function() {
  console.log(`Weathertop running and listening on port ${PORT}`);
});
