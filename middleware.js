const cors = require('cors');
const express = require('express');

const middleware = (app) => {
    app.use(cors());
    app.use(express.json());
};

module.exports = middleware;
