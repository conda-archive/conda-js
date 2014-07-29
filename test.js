var assert = require('assert');

var conda;
if (typeof window !== "undefined") {
    conda = window.conda;
    mocha.timeout(10000).slow(2000);
}
else {
    conda = require('./conda');
}

function test(conda) {
    function assertSuccess(result) {
        assert.ok((typeof result.success !== "undefined") && result.success);
    }

    function assertError(result) {
        assert.ok(typeof result.error !== "undefined");
    }

    function assertType(type) {
        return function(result) {
            assert.equal(typeof result, type);
        };
    }

    function assertInstance(klass) {
        return function(result) {
            assert.ok(result instanceof klass);
        };
    }

    function assertKey(key) {
        return function(result) {
            assert.ok(typeof result[key] !== "undefined");
        };
    }

    assertError = assertKey("error");

    function assertAll(asserts) {
        return function(result) {
            asserts.forEach(function(assert) {
                assert(result);
            });
        };
    }

    describe('info', function() {
        it('should return a dictionary', function(done) {
            conda.info().then(assertType('object')).then(done);
        });

        it('should contain various keys', function(done) {
            conda.info().then().then(assertAll([
                assertKey('channels'),
                assertKey('conda_version'),
                assertKey('default_prefix'),
                assertKey('envs'),
                assertKey('envs_dirs'),
                assertKey('is_foreign'),
                assertKey('pkgs_dirs'),
                assertKey('platform'),
                assertKey('python_version'),
                assertKey('rc_path'),
                assertKey('root_prefix'),
                assertKey('root_writable'),
            ])).done(done);
        });
    });

    describe('search', function() {
        it('should return a dictionary', function(done) {
            conda.search().then(assertType('object')).then(done);
        });
    });

    describe('run', function() {
        it('should return a dictionary', function(done) {
            conda.run('nonexistent').then(assertType('object')).then(done);
        });

        it('should error for a nonexistent app', function(done) {
            conda.run('nonexistent').then(assertError).then(done);
        });

        it('should error for a package that is not an app', function(done) {
            conda.run('python').then(assertError).then(done);
        });
    });

    describe('Config', function() {
        var config = new conda.Config();
        it("shouldn't accept both config and file", function(done) {
            assert.throws(function() {
                new conda.Config({ system: true, file: 'test' });
            });
            done();
        });

        describe("#get", function() {
            it("should only accept certain keys", function(done) {
                assert.throws(function() {
                    config.get('nonexistent_key').then(done);
                });
                done();
            });

            it("should return a dictionary", function(done) {
                config.get('channels').then(assertType('object')).done(done);
            });
        });

        describe("#getAll", function() {
            it("should return a dictionary", function(done) {
                config.get('channels').then(assertType('object')).done(done);
            });
        });

        describe("#set", function() {
            it("should only accept certain keys", function(done) {
                assert.throws(function() {
                    config.set('nonexistent_key', 'value').then(done);
                });
                done();
            });

            it("should succeed", function(done) {
                config.set('use_pip', true).then(assertSuccess).then(function() {
                    config.set('use_pip', false).then(assertSuccess).done(done);
                });
            });
        });
    });

    describe('Env', function() {
        var envs;
        before(function(done) {
            conda.Env.getEnvs().then(function(result) {
                envs = result;
                done();
            });
        });

        describe('.create', function() {
            it('should support progressbars', function(done) {
                var first = true;
                conda.Env.create({ name: 'testing', packages: ['_license'], progress: true })
                    .progress(function(progress) {
                        if (first) {
                            done();
                            first = false;
                        }
                    }).done(function() {
                        // happens when env was created beforehand
                        if (first) {
                            done();
                        }
                    });
            });
        });

        describe('.getEnvs', function() {
            it('should return a list of Envs', function() {
                assertInstance(conda.Env)(envs[0]);
            });
        });

        describe('#install', function() {
            it('should return a dictionary', function(done) {
                envs[0].install({ packages: ['python'] })
                    .then(assertSuccess).done(done);
            });
        });

        describe('#linked', function() {
            it('should return a list of Packages', function(done) {
                envs[0].linked().then(function(result) {
                    assert.ok(Array.isArray(result));
                    assertInstance(conda.Package)(result[0]);
                }).done(done);
            });

            it('should return a list of strings with simple=true', function(done) {
                envs[0].linked({ simple: true }).then(function(result) {
                    assert.ok(Array.isArray(result));
                    assertType('string')(result[0]);
                }).done(done);
            });
        });

        describe('#revisions', function() {
            it('should return a list of objects', function(done) {
                envs[0].revisions().then(function(result) {
                    assert.ok(Array.isArray(result));
                    assertType('object')(result[0]);
                }).done(done);
            });
        });

        // TODO this is extremely slow, times out
        // describe('#removeEnv', function() {
        //     it('should return a dictionary', function(done) {
        //         envs.forEach(function(env) {
        //             if (env.name === 'testing') {
        //                 env.removeEnv().then(assertType('object')).done(done);
        //             }
        //         });
        //     });
        // });
    });


    describe('Package', function() {
        describe('.parseVersion', function() {
            it('should parse any number of parts', function() {
                assert.deepEqual(conda.Package.parseVersion("1.2.3.4.5").parts, [1, 2, 3, 4, 5]);
            });

            it('should parse RC parts', function() {
                assert.deepEqual(conda.Package.parseVersion("1.2.3rc1").parts, [1, 2, 3]);
                assert.deepEqual(conda.Package.parseVersion("1.2.3rc1").suffixNumber, 1);
                assert.deepEqual(conda.Package.parseVersion("1.2.3").suffix, null);
            });
        });

        describe('.isGreater', function() {
            it('should compare build numbers', function() {
                assert.ok(conda.Package.isGreater({
                    version: "1.2.3",
                    build_number: 2
                }, {
                    version: "1.2.3",
                    build_number: 3
                }));
            });

            it('should compare versions', function() {
                assert.ok(conda.Package.isGreater({
                    version: "1.2.3",
                    build_number: 3
                }, {
                    version: "1.2.6",
                    build_number: 3
                }));
                assert.ok(conda.Package.isGreater({
                    version: "1.2.3",
                    build_number: 3
                }, {
                    version: "1.3.0",
                    build_number: 3
                }));
                assert.ok(conda.Package.isGreater({
                    version: "1.2.3",
                    build_number: 3
                }, {
                    version: "2.0.0",
                    build_number: 3
                }));
                assert.ok(conda.Package.isGreater({
                    version: "1.12.30",
                    build_number: 3
                }, {
                    version: "2.10.0",
                    build_number: 3
                }));
                assert.ok(conda.Package.isGreater({
                    version: "19.12.30",
                    build_number: 3
                }, {
                    version: "21.10.15",
                    build_number: 3
                }));
                assert.ok(conda.Package.isGreater({
                    version: "19.12.3",
                    build_number: 3
                }, {
                    version: "19.12.15",
                    build_number: 3
                }));
            });

            it('should compare versions of unequal length', function() {
                assert.ok(conda.Package.isGreater({
                    version: "1.2",
                    build_number: 3
                }, {
                    version: "1.2.3",
                    build_number: 3
                }));
            });

            it('should compare release candidate numbers', function() {
                assert.ok(conda.Package.isGreater({
                    version: "1.2.3rc1",
                    build_number: 3
                }, {
                    version: "1.2.3",
                    build_number: 3
                }));

                assert.ok(conda.Package.isGreater({
                    version: "1.2.3rc1",
                    build_number: 3
                }, {
                    version: "1.2.3rc2",
                    build_number: 3
                }));
            });

            it('should compare suffixes', function() {
                assert.ok(conda.Package.isGreater({
                    version: "1.2.3a",
                    build_number: 3
                }, {
                    version: "1.2.3",
                    build_number: 3
                }));

                assert.ok(conda.Package.isGreater({
                    version: "1.2.3a2",
                    build_number: 3
                }, {
                    version: "1.2.3a5",
                    build_number: 3
                }));

                assert.ok(conda.Package.isGreater({
                    version: "1.2.3a2",
                    build_number: 3
                }, {
                    version: "1.2.3",
                    build_number: 3
                }));
            });
        });
    });
}

describe('conda-js RPC mode', function() {
    test(conda);
});

if (typeof conda.newContext !== "undefined") {
    describe('conda-js REST mode', function() {
        var context = conda.newContext();
        context.API_METHOD = 'REST';
        context.API_ROOT = 'http://localhost:8001/api';
        test(context);
    });
}
