const express = require("express");
var pg = require("pg");
const dotenv = require("dotenv");

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

app.get('/dashboard', (req, res) => {
    res.render("dashboard");
});

app.get('/1', (req, res) => {
   dbClient.query("SELECT * FROM regensburg", function(dbError, dbResponse){
       res.render("details", {location: 'Regensburg', readings: dbResponse.rows});
});
});

app.get('/2', (req, res) => {
    dbClient.query("SELECT * FROM kelheim", function(dbError, dbResponse){
        res.render("details", {location: 'Kelheim', readings: dbResponse.rows});
    });
});

app.get('/3', (req, res) => {
    dbClient.query("SELECT * FROM muenchen", function(dbError, dbResponse){
        res.render("details", {location: 'München', readings: dbResponse.rows});
    });
});

app.listen(PORT, function() {
  console.log(`Weathertop running and listening on port ${PORT}`);
});
