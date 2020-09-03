'use strict';

const https = require('https');
const fs = require('fs');

const numberOfPages = 20;
const offset = 0;

const cache = JSON.parse(fs.readFileSync('./cache/cache.json', 'utf8'));

const dependencyCounts = {};
const devDependencyCounts = {};
const analyzedPackages = [];
const skippedPackages = [];

let timeoutTime = 100;

const main = async () => {
  let totalPackages = [];

  // Extraction of npm modules endpoints from pages
  for (let i = 1; i <= numberOfPages; i++) {
    await getPackagesFromHtmlList(i + offset).then(packages => {
      totalPackages = totalPackages.concat(packages);
    }).catch(err => {
      console.log(err);
    });
    // Timeout for not being blocked
    await timeout();
  }

  console.log('Analyzing', totalPackages.length, 'packages!');
  let counter = 0;

  // Extraction of package.json for each package
  for (const packageEndpoint of totalPackages) {
    counter++;
    console.log(counter, 'of', totalPackages.length, '- Package name: ', packageEndpoint.split('/').pop());
    await getGitHubFromPackageEndpoint(packageEndpoint).then(packageGithubUrl => {
      getPackageJsonFromGithubUrl(packageGithubUrl).then(packageJson => {
        if (packageJson !== undefined) {
          analyzedPackages.push(packageEndpoint);
          // Package.json analysis
          if (packageJson.dependencies) {
            for (const dependencyName of Object.keys(packageJson.dependencies)) {
              incrementDependencyCount(dependencyName, 0);
            }
          }
          if (packageJson.devDependencies) {
            for (const dependencyName of Object.keys(packageJson.devDependencies)) {
              incrementDependencyCount(dependencyName, 1);
            }
          }
        } else {
          skippedPackages.push(packageEndpoint);
        }
      }).catch(err => {
        console.log('  There was an error getting package.json for package', packageEndpoint.split('/').pop() + '. Ignoring package.');
        console.log('   ', err);
      });
    }).catch(err => {
      console.log('  There was an error getting github page for package', packageEndpoint.split('/').pop() + '. Ignoring package.');
      console.log('   ', err);
    });
    await timeout();
  }

  await timeout();

  // Sort and save results
  const dependenciesArray = [];
  for (var key of Object.keys(dependencyCounts)) {
    dependenciesArray.push([key, dependencyCounts[key]]);
  }
  dependenciesArray.sort((a, b) => {
    return b[1] - a[1];
  });

  const devDependenciesArray = [];
  for (var devKey of Object.keys(devDependencyCounts)) {
    devDependenciesArray.push([devKey, devDependencyCounts[devKey]]);
  }
  devDependenciesArray.sort((a, b) => {
    return b[1] - a[1];
  });

  fs.writeFileSync('./results/dependencies.json', JSON.stringify(dependenciesArray, undefined, 4), 'utf8');
  fs.writeFileSync('./results/devDependencies.json', JSON.stringify(devDependenciesArray, undefined, 4), 'utf8');
  fs.writeFileSync('./results/analyzedPackages.json', JSON.stringify(analyzedPackages, undefined, 4), 'utf8');
  fs.writeFileSync('./results/skippedPackages.json', JSON.stringify(skippedPackages, undefined, 4), 'utf8');

  console.log(analyzedPackages.length);

  fs.writeFileSync('./cache/cache.json', JSON.stringify(cache), 'utf8');

  generateCSVs(dependencyCounts, devDependencyCounts).then(() => {
    console.log('Fetching complete!', analyzedPackages.length, 'packages analyzed. See results folder for all the information.');
  });
};

const getPackagesFromHtmlList = (page) => {
  return new Promise((resolve, reject) => {
    const data = fs.readFileSync('./pages/' + page + '.html', 'utf8');
    try {
      // Extracting sections from most dependant page
      const sections = data.split('<section class="ef4d7c63 flex flex-row-reverse pl1-ns pt3 pb2 ph1 bb b--black-10 "><div class="w-20"></div><div class="w-80"><div class="flex flex-row items-end pr3">');
      // Removing first element of the split
      sections.splice(0, 1);

      const packages = [];

      for (const section of sections) {
        packages.push(section.split('>')[0].split('"')[3].split('npmjs.com')[1]);
      }

      resolve(packages);
    } catch (err) {
      reject(err);
    }
  });
};

const getPackageJsonFromGithubUrl = (githubUrl) => {
  return new Promise((resolve, reject) => {
    try {
      // Exceptions
      if (githubUrl.split('github.com').length === 1) {
        console.log('  Skipping, not GitHub repository');
        resolve(undefined);
      } else if (githubUrl.split('github.com')[1].split('/')[1].substring(0, 3) === 'npm') {
        console.log('  Skipping npm because it cannot be parsed');
        resolve(undefined);
      } else if (githubUrl.split('github.com')[1].split('/')[1].substring(0, 6) === 'babel') {
        console.log('  Skipping babel because it cannot be parsed');
        resolve(undefined);
      } else if (githubUrl.split('github.com')[1].split('/')[1].substring(0, 6) === 'dotenv-expand') {
        console.log('  Skipping dotenv-expand because it is giving trouble');
        resolve(undefined);
      } else {
        getWebpageJSON('https://raw.githubusercontent.com' + githubUrl.split('github.com')[1] + '/master/package.json').then(json => {
          resolve(json);
        }).catch(err => {
          reject(err);
        });
      }
    } catch (err) {
      reject(err);
    }
  });
};

const getGitHubFromPackageEndpoint = (packageEndpoint) => {
  return new Promise((resolve, reject) => {
    try {
      getWebpageString('https://www.npmjs.com' + packageEndpoint).then(webpage => {
        const sectionSplit = webpage.split('<div class="_702d723c dib w-50 bb b--black-10 pr2 w-100"><h3 class="c84e15be f5 mt2 pt2 mb0 black-50">');
        for (const section of sectionSplit) {
          if (section.substring(0, 10) === 'Repository') {
            resolve(section.split('<a class="b2812e30 f2874b88 fw6 mb3 mt2 truncate black-80 f4 link" rel="noopener noreferrer nofollow" href="')[1]
              .split('"')[0]);
          }
        }
        reject(new Error('No Repository found.'));
      }).catch(err => {
        reject(err);
      });
    } catch (err) {
      reject(err);
    }
  });
};

// Auxiliary

const getWebpageString = (url) => {
  return new Promise((resolve, reject) => {
    console.log('  Requesting webpage:', url);
    try {
      if (Object.keys(cache).includes(url) && cache[url].substring(0, 30) !== '{"message":"Too Many Requests"') {
        timeoutTime = 50;
        resolve(cache[url]);
      } else {
        timeoutTime = 100; // 10000
        https.get(url, (resp) => {
          let data = '';

          // A chunk of data has been recieved.
          resp.on('data', (chunk) => {
            data += chunk;
          });

          // The whole response has been received. Print out the result.
          resp.on('end', () => {
            cache[url] = data;
            resolve(data);
          });
        }).on('error', (err) => {
          reject(err);
        });
      }
    } catch (err) {
      reject(err);
    }
  });
};

const getWebpageJSON = (url) => {
  console.log('  Requesting package.json:', url);
  return new Promise((resolve, reject) => {
    try {
      if (Object.keys(cache).includes(url) && cache[url].substring(0, 4) !== '404:') {
        timeoutTime = 50;
        try {
          resolve(JSON.parse(cache[url]));
        } catch (err) {
          reject(err);
        }
      } else {
        timeoutTime = 100; // 10000
        https.get(url, (resp) => {
          let data = '';

          // A chunk of data has been recieved.
          resp.on('data', (chunk) => {
            data += chunk;
          });

          // The whole response has been received. Print out the result.
          resp.on('end', () => {
            if (data.substring(0, 4) !== '404:') {
              try {
                cache[url] = data;
                resolve(JSON.parse(data));
              } catch (err) {
                reject(err);
              }
            } else { reject(new Error('Incorrect GitHub package.json endpoint.')); }
          });
        }).on('error', (err) => {
          reject(err);
        });
      }
    } catch (err) {
      reject(err);
    }
  });
};

const incrementDependencyCount = (dependencyName, isDev) => {
  if (isDev) {
    if (Object.keys(dependencyCounts).includes(dependencyName)) {
      dependencyCounts[dependencyName] = dependencyCounts[dependencyName] + 1;
    } else { dependencyCounts[dependencyName] = 1; }
  } else {
    if (Object.keys(devDependencyCounts).includes(dependencyName)) { devDependencyCounts[dependencyName] = devDependencyCounts[dependencyName] + 1; } else { devDependencyCounts[dependencyName] = 1; }
  }
};

function timeout () {
  return new Promise(resolve => setTimeout(resolve, timeoutTime));
}

main();

// CSV Generation
const categories = {
  testing: [
    'jest', 'karma', 'mocha', 'ava', 'tap', 'tape', 'jasmine', 'browserstack', 'chai'
  ],
  linting: [
    'eslint', 'standard', 'xo', 'semistandard', 'standardx'
  ],
  /* "ci": [
    "travis", "githubactions"
  ], */
  coverage: [
    'coveralls', 'nyc&istanbul', 'codecov'
  ],
  dependencies: [
    'david-dm', 'snyk', 'greenkeeper'
  ],
  benchmarking: [
    'benchmark', 'matcha'
  ],
  other: [
    'chalk', 'prettier', 'packagephobia', 'bundlephobia'
  ],
  new: [
    'husky', 'rimraf', 'webpack', 'rollup', 'glob', 'sinon', 'uglify-js', 'gulp', 'semver', 'browserify', 'minimist', 'minimatch'
  ]
};

const generateCSVs = (dependencyCounts, devDependencyCounts) => {
  return new Promise((resolve, reject) => {
    fs.unlinkSync('./results/toolCount.csv');

    for (const category of Object.keys(categories)) {
      fs.appendFileSync('./results/toolCount.csv', 'Tool, Usage\n');

      for (const tool of categories[category]) {
        let depC = 0;
        let devDepC = 0;

        for (const subTool of tool.split('&')) {
          depC += dependencyCounts[subTool] ? dependencyCounts[subTool] : 0;
          devDepC += devDependencyCounts[subTool] ? devDependencyCounts[subTool] : 0;
        }

        const line = tool.replace(/^\w/, c => c.toUpperCase()) + ', ' + (depC + devDepC) + '\n';

        fs.appendFileSync('./results/toolCount.csv', line);
      }
      fs.appendFileSync('./results/toolCount.csv', '\n\n\n\n\n\n');
    }
    resolve();
  });
};
