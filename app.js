const express = require("express");
var pg = require("pg");
const dotenv = require("dotenv");
const {max, rows} = require("pg/lib/defaults");

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

app.get('/stations', async(req, res) => {


    var readingArray = [];
    let station_id_index = await dbClient.query("SELECT id FROM stations");

    for (let index = 0; index < station_id_index.rows.length; index++) {
        console.log(station_id_index.rows[index].id);
        let stations = await dbClient.query("SELECT * FROM stations JOIN readings ON stations.id = readings.station_id WHERE station_id=$1", [station_id_index.rows[index].id]);
        console.log(stations.rows);
        readingArray.push(stations.rows[stations.rows.length - 1]);
    }

    res.render("dashboard", {
        latestreadings: readingArray
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
