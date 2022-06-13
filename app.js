const express = require("express");
var pg = require("pg");
const dotenv = require("dotenv");
var session = require("express-session");
const {max} = require("pg/lib/defaults");
const {urlencoded} = require("express");

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

app.use(session({
    secret: "This is a secret!",
    cookie: { maxAge: 3600000 },
    resave: true,
    saveUninitialized: true
}));


app.get('/', (req, res) => {
    res.render("index");
});

app.post("/", urlencoded({ extended: false }), function(req,res){
    var email = req.body.email;
    var password = req.body.password;

    dbClient.query("SELECT * FROM users WHERE email=$1 AND password=$2", [email, password], async function (dbError, dbResponse) {
        if (dbResponse.rows.length === 0) {
            res.render("index", {login_error: true});
        }
        else {
            req.session.user_id = dbResponse.rows[0].id;
            res.redirect("stations");
        }
    });

});

app.get('/stations', async(req, res) => {

    if(req.session.user_id == undefined){
        res.render("index", {login_error: true});
    }

     req.session.readingArray = [];

    // var readingArray = [];

    //initSession(req.session); // Array is not cleared after adding, so causing multiple same items in the same array.
    //Same Browser shares same cookie id? Muss sichergestellt, dass bei dem Fall die Webseite auch funktioniert?


    let station_id_index = await dbClient.query("SELECT id FROM stations where user_id = $1", [req.session.user_id]);


    for (let index = 0; index < station_id_index.rows.length; index++) {
        let stations = await dbClient.query("SELECT * FROM stations JOIN readings ON stations.id = readings.station_id WHERE station_id=$1", [station_id_index.rows[index].id]);
        req.session.readingArray.push(stations.rows[stations.rows.length - 1]);
    }

    res.render("dashboard", {
        latestreadings: req.session.readingArray
    });

});

app.post("/stations", urlencoded({ extended: false }), function(req,res){

    //insert station
    var stationname = req.body.station_name;
    var xposition = req.body.xposition;
    var yposition = req.body.yposition;

    //delete station
    var stationid_tobeDeleted = req.body.stationid;

    if(stationid_tobeDeleted != undefined){
        dbClient.query("DELETE FROM readings WHERE station_id = $1", [stationid_tobeDeleted]);
        dbClient.query("DELETE FROM stations WHERE id = $1", [stationid_tobeDeleted]);
    }

    else {
        dbClient.query("INSERT INTO stations (station, latitude, longitude, user_id) VALUES ($1, $2, $3, $4)", [stationname, xposition, yposition, req.session.user_id]); //kann man function(dbError,...) weglassen

        dbClient.query("SELECT * FROM stations ORDER BY id DESC LIMIT 1", function (dbError, dbResponse) {
            var max_station_id = dbResponse.rows[0].id;
            dbClient.query("INSERT INTO readings (station_id, user_id) VALUES ($1, $2)", [max_station_id, req.session.user_id]);
            //console.log(max_station_id);
        });
    }


    res.redirect("/stations");

});

app.get("/stations/:id", function (req, res) {

    if(req.session.user_id == undefined){
        res.render("index", {login_error: true});
    }

    /* List details about a station */
    var stationId = req.params.id;

    dbClient.query("SELECT * FROM stations WHERE id=$1", [stationId], function (dbError, dbStationResponse) {
        dbClient.query("SELECT * FROM readings WHERE station_id=$1", [stationId], function (dbError, dbReadingsResponse) {

                res.render("details", {
                    station: dbStationResponse.rows[0],
                    latest_reading: dbReadingsResponse.rows[dbReadingsResponse.rows.length-1],
                    readings: dbReadingsResponse.rows.reverse()
                });
        });
    });


});

app.post("/stations/:id", urlencoded({ extended: false }), async function(req,res) {

    var stationId = req.params.id;
    let readings = await dbClient.query("SELECT * from readings where station_id = $1", [stationId]);

    //insert reading
    var weatherCode = req.body.weather_code;
    var temp = req.body.temperature;
    var windSpeed = req.body.wind_speed;
    var windDirection = req.body.wind_direction;
    var airPressure = req.body.airpressure;
    //delete reading
    var reading_tobeDeleted = req.body.readingid;

    if (reading_tobeDeleted != undefined) {
        if (readings.rows.length == 1) {
           dbClient.query("UPDATE readings SET weather = null, temperature = null, wind = null, direction = null, pressure = null WHERE id = $1", [reading_tobeDeleted]);
        } else {
            dbClient.query("DELETE FROM readings WHERE id = $1", [reading_tobeDeleted]);
        }
        //updating max and min temperature after deleting readings
        let max_temp_afterdelete = await dbClient.query("SELECT MAX(temperature) FROM readings WHERE station_id=$1", [stationId]);
        let min_temp_afterdelete = await dbClient.query("SELECT MIN(temperature) FROM readings WHERE station_id=$1", [stationId]);
        dbClient.query("UPDATE stations SET max_temp = $1 WHERE id = $2", [max_temp_afterdelete.rows[0].max, stationId]);
        dbClient.query("UPDATE stations SET min_temp = $1 WHERE id = $2", [min_temp_afterdelete.rows[0].min, stationId]);
    }

    else {
        var currentdate = new Date().toString();

        if (readings.rows.length == 1 && readings.rows[0].weather == null && readings.rows[0].temperature == null && readings.rows[0].wind == null && readings.rows[0].pressure == null) {
            dbClient.query("UPDATE readings SET time = $1, weather = $2, temperature = $3, wind = $4, direction = $5, pressure = $6 WHERE station_id = $7", [currentdate, weatherCode, temp, windSpeed, windDirection, airPressure, stationId]);
        }
        else {
            dbClient.query("INSERT into readings (time, station_id, weather, temperature, wind, direction, pressure) VALUES ($1, $2, $3, $4, $5, $6, $7)", [currentdate, stationId, weatherCode, temp, windSpeed, windDirection, airPressure]);
        }

        //updating max and min temperature after adding new readings
        let max_temp = await dbClient.query("SELECT MAX(temperature) FROM readings WHERE station_id=$1", [stationId]);
        let min_temp = await dbClient.query("SELECT MIN(temperature) FROM readings WHERE station_id=$1", [stationId]);

        if(temp >= max_temp.rows[0].max){
            dbClient.query("UPDATE stations SET max_temp = $1 WHERE id = $2", [max_temp.rows[0].max, stationId]);
        }

        if(temp <= min_temp.rows[0].min){
            dbClient.query("UPDATE stations SET min_temp = $1 WHERE id = $2", [min_temp.rows[0].min, stationId]);
        }

    }
    res.redirect("/stations/"+stationId);

});

app.get("/register", function (req, res) {

    res.render("register");

});


app.post("/register", urlencoded({ extended: false }), async function(req,res){
    var email = req.body.email;
    var firstname = req.body.firstname;
    var lastname = req.body.lastname;
    var password = req.body.password;

    dbClient.query("INSERT into users (email, firstname, lastname, password) VALUES ($1, $2, $3, $4)", [email, firstname, lastname, password]);
    res.render("index");
});

app.get("/logout", function(req, res) {
    req.session.destroy(function (err) {
        console.log("Session destroyed.");
   });
    res.render("index");
});

app.listen(PORT, function() {
    console.log(`Weathertop running and listening on port ${PORT}`);
});



