"use strict";
exports.__esModule = true;
exports["default"] = (function (sequelize, DataTypes) {
    return sequelize.define('joined_server', {
        server_id: {
            type: DataTypes.STRING,
            primaryKey: true
        },
        user_id: {
            type: DataTypes.STRING,
            primaryKey: true
        }
    }, { timestamps: false });
});
