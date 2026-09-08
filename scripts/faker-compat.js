'use strict';

const Module = require('node:module');

const LEGACY_FAKER_REQUEST = '@faker-js/faker/locale/en';
let installed = false;

function bind(module, name) {
  const value = module?.[name];
  return typeof value === 'function' ? value.bind(module) : value;
}

function namespace(module, aliases = {}) {
  return new Proxy(module, {
    get(target, property) {
      if (Object.prototype.hasOwnProperty.call(aliases, property)) return aliases[property];
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function createLegacyFaker(faker) {
  const categoryImage = (category) => () => faker.image.urlLoremFlickr({ category });

  const aliases = {
    address: namespace(faker.location, {
      city: bind(faker.location, 'city'),
      streetName: bind(faker.location, 'street'),
      streetAddress: bind(faker.location, 'streetAddress'),
      country: bind(faker.location, 'country'),
      countryCode: bind(faker.location, 'countryCode'),
      latitude: bind(faker.location, 'latitude'),
      longitude: bind(faker.location, 'longitude'),
    }),
    commerce: namespace(faker.commerce, {
      color: bind(faker.color, 'human'),
    }),
    company: namespace(faker.company, {
      companyName: bind(faker.company, 'name'),
      companySuffix: () => String(faker.company.name()).split(/\s+/).at(-1),
      bs: bind(faker.company, 'buzzPhrase'),
      bsAdjective: bind(faker.company, 'buzzAdjective'),
      bsBuzz: bind(faker.company, 'buzzVerb'),
      bsNoun: bind(faker.company, 'buzzNoun'),
    }),
    datatype: namespace(faker.datatype, {
      number: (options) => faker.number.int(options),
      uuid: bind(faker.string, 'uuid'),
    }),
    finance: namespace(faker.finance, {
      account: bind(faker.finance, 'accountNumber'),
      mask: () => faker.finance.iban().replace(/(?<=.{4})\w(?=.{2})/g, '*'),
    }),
    image: namespace(faker.image, {
      avatar: bind(faker.image, 'avatar'),
      imageUrl: bind(faker.image, 'url'),
      abstract: categoryImage('abstract'),
      animals: categoryImage('animals'),
      business: categoryImage('business'),
      cats: categoryImage('cats'),
      city: categoryImage('city'),
      food: categoryImage('food'),
      nightlife: categoryImage('nightlife'),
      fashion: categoryImage('fashion'),
      people: categoryImage('people'),
      nature: categoryImage('nature'),
      sports: categoryImage('sports'),
      transport: categoryImage('transport'),
    }),
    internet: namespace(faker.internet, {
      userName: bind(faker.internet, 'username'),
      color: () => faker.color.rgb(),
    }),
    name: namespace(faker.person, {
      firstName: bind(faker.person, 'firstName'),
      lastName: bind(faker.person, 'lastName'),
      findName: bind(faker.person, 'fullName'),
      jobTitle: bind(faker.person, 'jobTitle'),
      prefix: bind(faker.person, 'prefix'),
      suffix: bind(faker.person, 'suffix'),
      jobDescriptor: bind(faker.person, 'jobDescriptor'),
      jobArea: bind(faker.person, 'jobArea'),
      jobType: bind(faker.person, 'jobType'),
    }),
    phone: namespace(faker.phone, {
      phoneNumberFormat: () => faker.helpers.fromRegExp(/[0-9]{3}-[0-9]{3}-[0-9]{4}/),
    }),
    random: {
      arrayElement: bind(faker.helpers, 'arrayElement'),
      word: bind(faker.lorem, 'word'),
      alphaNumeric: bind(faker.string, 'alphanumeric'),
    },
  };

  return new Proxy(faker, {
    get(target, property) {
      if (Object.prototype.hasOwnProperty.call(aliases, property)) return aliases[property];
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function installFakerCompatibility() {
  if (installed) return;
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === LEGACY_FAKER_REQUEST) {
      const modern = originalLoad.call(this, request, parent, isMain);
      if (!modern?.faker) throw new Error('Faker locale module does not expose the expected modern faker instance');
      return createLegacyFaker(modern.faker);
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  installed = true;
}

module.exports = { installFakerCompatibility };
