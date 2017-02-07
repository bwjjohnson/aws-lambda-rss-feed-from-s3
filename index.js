'use strict';

let AWS = require('aws-sdk');
AWS.config.region = 'us-west-2';

var RSS = require('rss');
var pd = require('pretty-data').pd;

let s3 = new AWS.S3({apiVersion: '2006-03-01'});
var listObjectsV2Param = {
  Bucket: 'media.downtowncornerstone.org',
  MaxKeys: 1000,
  Prefix: 'bands/'
};

var mediaURL = 'http://media.downtowncornerstone.org/';
var callsRemaining = 10;
var maxItemsInRSSFeed = 25;
var bandAudioFiles = [];

exports.handler = (event, context, callback) => {
  // Kick off lambda by listing objecst from S3
  console.log("Listing files from S3 bucket...");
  s3.listObjectsV2(listObjectsV2Param, handleListObjectsV2);
};

function handleListObjectsV2(err, data) {
  callsRemaining -= 1;
  if (err) {
    console.log(err, err.stack);
  } else {
    // console.log(data);
    console.log("Retrieved " + data.Contents.length + " files from S3");
    bandAudioFiles = bandAudioFiles.concat(data.Contents);
    if (callsRemaining >= 1 || callsRemaining < 0) {
      listObjectsV2Param.ContinuationToken = data.NextContinuationToken;
      s3.listObjectsV2(listObjectsV2Param, handleListObjectsV2);
    } else {
      doneGettingS3Objects();
    }
  }
}

function doneGettingS3Objects() {
  console.log('Completed getting file information from S3');

  // remove duplicate files
  bandAudioFiles = bandAudioFiles.filter(function(item, pos, array){
    return array.map(function(mapItem){ return mapItem.Key; }).indexOf(item.Key) === pos;
  });

  // Only mp3 files that are worship songs
  bandAudioFiles = bandAudioFiles.filter(
    function(file){
      if ( ! file.Key.match(/\.mp3$/) ) return false;
      if ( file.Key.match(/speaking|reading|sermon|advent|announcement|assurance|bendiction|confession|commission|farewell|welcome|call_to_worship|exhortation|justification|passage|scripture|candle lighting/i)) return false;
      return true;
    }
  );

  for (var i in bandAudioFiles){
    var file = bandAudioFiles[i];
    file = parseAudioFile(file);
  }

  // Remove files without a valid date
  bandAudioFiles = bandAudioFiles.filter(
    function(file){ return file !== null && file.date !== null; }
  );

  // Sort in reverse chronological order
  bandAudioFiles.sort(function(a,b){
    if(a.date < b.date) return 1;
    if(a.date > b.date) return -1;
    return 0;
  });

  console.log('Total number of audio files: ' + bandAudioFiles.length);
  // console.log(bandAudioFiles);

  generateRSSFeed();
}

function baseName(str){
  var base = str.substring(str.lastIndexOf('/') + 1);
  if (base.lastIndexOf(".") != -1)
    base = base.substring(0, base.lastIndexOf("."));
  return base;
}

function parseAudioFile(file){
  var filename = file.Key;
  // console.log("filename = '" + filename + "'");
  var filebase = baseName(filename);
  file.date = filePathToDateString(filebase);
  file.title = filePathToTitle(filebase);
  return file;
}

function filePathToDateString(path){
  var dateStr = path.match(/^[0-9]{8}/);
  if (dateStr !== null) {
    dateStr = dateStr[0].replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3");
  } else {
    return null;
  }
  var date = new Date();
  var secs = Date.parse(dateStr);
  if (isNaN(secs)) {
    var match = path.match(/^[0-9]{8}/);
    if ( match !== null ) {
      dateStr = match[0].replace(/(\d{2})(\d{2})(\d{4})/, "$1-$2-$3");
      secs = Date.parse(dateStr);
    } else {
      return null;
    }
  }
  date.setTime(secs);
  return date.toISOString().substring(0, 10);
}

function filePathToTitle(path) {
  var file = baseName(path);
  var noExt = file.replace('.mp3$', '');
  var words = noExt.replace(/^[0-9]*/, '');
  var noUnderscores = words.replace(/_/g, ' ');
  var noDashes = noUnderscores.replace(/-/g, ' ');
  var titleCase = noDashes.replace(/(?:^|\s)\w/g, function(match) {
    return match.toUpperCase();
  });
  var title = titleCase.replace(/([A-Z])/g, " $1");
  title = title.replace(/ +/g, " ");
  // remove duplicate spaces
  title = title.replace(/^ /, "");
  // remove a leading space
  title = title.replace(/ Bandjam| Band Jam| 1st| 1| 2nd| 2| Intro| Multi/, "");
  return title;
}


function generateRSSFeed(){
  var feed = new RSS({
    title: 'DCC - Band Reference Audio',
    description: 'A feed for worship band members to get audio recordings of worship songs',
    feed_url: mediaURL + 'DCCBandRef.xml',
    site_url: mediaURL,
    webMaster: 'webmaster@downtowncornerstone.org (Web Master)',
    copyright: 'Downtown Cornerstone Church 2016',
    language: 'en',
    pubDate: new Date().toUTCString(),
    ttl: '60',
    custom_namespaces: {
      'itunes': 'http://www.itunes.com/dtds/podcast-1.0.dtd'
    },
    custom_elements: [
      {'itunes:category': [
        {_attr: {
          text: 'Religion & Spirituality'
        }},
        {'itunes:category': {
          _attr: {
            text: 'Christianity'
          }
        }}
      ]},
      {'itunes:owner': [
        {'itunes:name': 'Web Master'},
        {'itunes:email': 'webmaster@downtowncornerstone.org'}
      ]},
      {'itunes:image': {
        _attr: {
          href: 'http://media.downtowncornerstone.org/images/DCC-icon_85bk_itunes.jpg'
        }
      }},
      {'itunes:explicit': 'no'},
    ]
  });

  for (var i in bandAudioFiles){
    if ( i >= maxItemsInRSSFeed ){break;}
    var file = bandAudioFiles[i];
    // console.log(file);
    var title = file.date + " " + file.title;
    feed.item({
      title: title,
      description: title,
      url: mediaURL + file.Key,
      date: file.LastModified,
      enclosure: {url: mediaURL + file.Key}
    });
  }

  var xml = pd.xml(feed.xml());
  console.log('Generated RSS Feed');
  // console.log('xml = ' + xml);
  uploadRSSFeedToS3(xml);
}

function uploadRSSFeedToS3(xml){
  var uploadParams = {
    Bucket: 'media.downtowncornerstone.org', 
    Key: 'DCCBandRef.xml', 
    Body: xml,
    ContentType: 'application/rss+xml'};
  s3.upload(uploadParams, function(err, data) {
    if (err) {
      console.log("Error uploading data: ", err);
    } else {
      console.log("Successfully updated feed at " + uploadParams.Bucket + '/' + uploadParams.Key);
    }
  });
}

