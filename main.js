#!/usr/bin/env node

const columnify = require('columnify');
const program = require('commander');
const fs = require('fs');
const fetch = require('node-fetch');


/**
 * Convert a user key and secret assigned to them on an encoded site to an authorization string for
 * XHR requests.
 * @param {string} key Authorization key from encoded
 * @param {string} secret Authorization secret from encoded
 *
 * @return {string} Authorization string; use in XHR request headers.
 */
const keypairToAuth = (key, secret) => (
    `Basic ${Buffer.from(unescape(encodeURIComponent(`${key}:${secret}`))).toString('base64')}`
);


/**
 * Extract the value of an object property based on a dotted-notation field,
 * e.g. { a: 1, b: { c: 5 }} you could retrieve the 5 by passing 'b.c' in `field`.
 * Based on https://stackoverflow.com/questions/6393943/convert-javascript-string-in-dot-notation-into-an-object-reference#answer-6394168
 * @param {object} object Object containing the value you want to extract.
 * @param {string} field  Dotted notation for the property to extract.
 *
 * @return {value} Whatever value the dotted notation specifies, or undefined.
 */
const getObjectFieldValue = (object, field) => {
    const parts = field.split('.');
    if (parts.length === 1) {
        return object[field];
    }
    return parts.reduce((partObject, part) => partObject[part], object);
};


/**
 * Do a search of the ENCODE host for all the experiments specified by an array of @ids. Only the
 * specified fields get retreived.
 * @param {array}  experiments Experiment @ids to search
 * @param {array}  fields Fields to retrieve
 * @param {string} host URL of host to perform search on
 * @param {string} auth base64-encoded key and secret for POST permission
 *
 * @return {Promise} Search result object
 */
const cartQuery = (experiments, fields, host, auth) => {
    const fieldQuery = fields.map(field => `field=files.${field}`).join('&');
    const url = `${host}/search_elements/type=Experiment&${fieldQuery}&field=files.restricted&limit=all&filterresponse=off`;
    return fetch(url, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: auth,
        },
        body: JSON.stringify({
            '@id': experiments,
        }),
    }).then((response) => {
        // Convert response to JSON
        if (response.ok) {
            return response.json();
        }
        throw new Error('not ok');
    }).catch((e) => {
        console.log('OBJECT LOAD ERROR: %s', e);
    });
};


/**
 * Read a file and return its data in a Promise.
 * @param {string} path to a file
 * @param {string} opts Any encoding option
 *
 * @return {string} Contents of file
 */
const readFile = (path, opts = 'utf8') => (
    new Promise((resolve, reject) => {
        fs.readFile(path, opts, (err, data) => {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    })
);


/**
 * Retrieve the JSON contents of the key file that contains the authentication information as well
 * as the URL of the host we'll be searching.
 * @param {string} keyfile keyfile path name
 *
 * @return {Promise} JSON contents of key file
 */
const readKeyfile = async (keyfile) => {
    const results = await readFile(keyfile);
    return JSON.parse(results);
};


/**
 * Retrieve the JSON contents of the experiment file that contains the list of experiments to
 * search for and the fields of the experiment to return in the search.
 * @param {string} experimentFile File with list of experiments
 *
 * @return {Promise} JSON contents of the file.
 */
const readExperimentsFile = async (experimentFile) => {
    const results = await readFile(experimentFile);
    return JSON.parse(results);
};


program
    .version('1.0.0')
    .option('-k, --key [key]', 'key of keyfile', 'localhost')
    .option('-f, --keyfile [filename]', 'keyfile name/path', 'keypairs.json')
    .option('-e, --experiments [filename]', 'experiment file/path', 'experiments.json')
    .parse(process.argv);


let keyFileData;
let fileFields;
const cartDataPromise = readKeyfile(program.keyfile).then((resultJson) => {
    keyFileData = resultJson;
    return readExperimentsFile(program.experiments);
}).then((experimentInfo) => {
    const auth = keypairToAuth(keyFileData[program.key].key, keyFileData[program.key].secret);
    fileFields = experimentInfo.fields;
    return cartQuery(experimentInfo.experiments, experimentInfo.fields, keyFileData[program.key].server, auth);
});

const filePropCountPromise = cartDataPromise.then((cartData) => {
    // Make an array of all partial file objects returned in search results.
    const files = [];
    cartData['@graph'].forEach((experiment) => {
        if (experiment.files && experiment.files.length > 0) {
            files.push(...experiment.files);
        }
    });

    // Make a new object tracking the counts of each value of each property in all files.
    const filePropCounts = {};
    files.forEach((file) => {
        fileFields.forEach((field) => {
            const fieldValue = getObjectFieldValue(file, field);
            if (fieldValue) {
                if (filePropCounts[field]) {
                    // Already wrote this field into filePropCounts.
                    if (filePropCounts[field][fieldValue]) {
                        // Already wrote this field's value into filePropCounts
                        filePropCounts[field][fieldValue] += 1;
                    } else {
                        // First time writing this field's value into filePropCounts
                        filePropCounts[field][fieldValue] = 1;
                    }
                } else {
                    // First time writing this field into filePropCounts.
                    filePropCounts[field] = {};
                    filePropCounts[field][fieldValue] = 1;
                }
            }
        });
    });
    return filePropCounts;
});

filePropCountPromise.then((filePropCounts) => {
    Object.keys(filePropCounts).forEach((fileProp) => {
        console.log(`${fileProp}:`);
        const singlePropCounts = filePropCounts[fileProp];
        console.log(columnify(singlePropCounts, { config: { value: { align: 'right' } } }));
        console.log('\n');
    });
});
