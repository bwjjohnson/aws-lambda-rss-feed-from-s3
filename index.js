'use strict';

let AWS = require('aws-sdk');
AWS.config.region = 'us-west-2';

var RSS = require('rss');

let s3 = new AWS.S3({apiVersion: '2006-03-01'});
var listObjectsV2Param = {
  Bucket: 'media.downtowncornerstone.org',
  MaxKeys: 1000,
  Prefix: 'bands/'
};
var callsRemaining = 10;
var bandAudioFiles = new Array();

exports.handler = (event, context, callback) => {
  // Kick off lambda by listing objecst from S3
  s3.listObjectsV2(listObjectsV2Param, handleListObjectsV2);
};

function handleListObjectsV2(err, data) {
  callsRemaining -= 1;
  if (err) {
    console.log(err, err.stack);
  } else {
    // console.log(data);
    bandAudioFiles = bandAudioFiles.concat(data['Contents']);
    if (callsRemaining >= 1 || callsRemaining < 0) {
      listObjectsV2Param['ContinuationToken'] = data['NextContinuationToken'];
      s3.listObjectsV2(listObjectsV2Param, handleListObjectsV2);
    } else {
      doneGettingS3Objects();
    }
  }
};

function doneGettingS3Objects() {
  console.log('Completed getting file information from S3');
  console.log('Total number of files: ' + bandAudioFiles.length);
  var feed = new RSS({
    title: 'DCC - Band Reference Audio',
    description: 'A feed for worship band members to get audio recordings of worship songs',
    feed_url: 'http://media.downtowncornerstone.org/DCCBandRef.xml',
    site_url: 'http://www.downtowncornerstone.org',
    webMaster: 'webmaster@downtowncornerstone.org (Ben Johnson)',
    copyright: 'Downtown Cornerstone Church 2016',
    language: 'en',
    pubDate: new Date().toUTCString(),
    ttl: '60',
  });

  for (var i in bandAudioFiles){
    var file = bandAudioFiles[i];
    feed.item({
      title: file['Key'],
      summary: 'none',
      description: 'none',
      url: 'http://media.downtowncornerstone.org/' + file['Key'],
      date: file['LastModified'],
      enclosure: {url: 'http://media.downtowncornerstone.org/' + file['Key']}
    });
  }
 
  var xml = feed.xml();
  console.log('Generated RSS Feed');
  var uploadParams = {
    Bucket: 'media.downtowncornerstone.org', 
    Key: 'DCCBandRef.xml', 
    Body: xml,
    ContentType: 'application/rss+xml'};
  s3.upload(uploadParams, function(err, data) {
    if (err) {
      console.log("Error uploading data: ", err);
    } else {
      console.log("Successfully updated feed at " + uploadParams['Bucket'] + '/' + uploadParams['Key']);
    }
  });
}

