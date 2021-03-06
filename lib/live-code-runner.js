'use babel';
/*
live-code-runner
(C) Copyright 2016-2017 Lablup Inc.
Licensed under MIT
*/
/*jshint esnext: true */
let AtomLiveCodeRunner;
import AtomLiveCodeRunnerView from './live-code-runner-view';
import { CompositeDisposable } from 'atom';
import crypto from 'crypto';
import BackendAISDK from './backend-ai-api-v3';

export default AtomLiveCodeRunner = {
  config: require('./config.js'),
  AtomLiveCodeRunnerView: null,
  resultPanel: null,
  subscriptions: null,
  code: null,
  accessKey: null,
  secretKey: null,
  signKey: null,
  runId: null,
  apiVersion: 'v2.20170315',
  hash_type: 'sha256',
  baseURL: 'https://api.backend.ai',
  kernelId: null,
  kernelType: null,
  BackendAISDK: null,
  continuation: null,
  waiting_input: null,
  _exec_starts: null,

  // dev mode for autoreload-package-service
  consumeAutoreload(reloader) {
    return reloader({pkg:"live-code-runner",files:["package.json"],folders:["lib/"]});
  },

  activate(state) {
    if (atom.inDevMode()) {
      try {
        return this.realActivate(state);
      } catch (e) {
        return console.log(e);
      }
    } else {
      return this.realActivate(state);
    }
  },

  deactivate() {
    this.resultPanel.destroy();
    return this.subscriptions.dispose();
  },

  realActivate(state) {
    this.AtomLiveCodeRunnerView = new AtomLiveCodeRunnerView(state.AtomLiveCodeRunnerViewState, this);
    this.resultPanel = atom.workspace.addBottomPanel({item: this.AtomLiveCodeRunnerView.getElement(), visible: false});
    this.BackendAISDK = new BackendAISDK();
    this.continuation = false;
    this.waiting_input = false;

    // Events subscribed to in atom's system can be easily cleaned up with a CompositeDisposable
    this.subscriptions = new CompositeDisposable();
    this.checkMandatorySettings();

    // Register command
    return this.subscriptions.add(atom.commands.add('atom-text-editor',
      {'live-code-runner:run': () => this.runcode()})
    );
  },

  serialize() {
    return {AtomLiveCodeRunnerViewState: this.AtomLiveCodeRunnerView.serialize()};
  },

  getAccessKey() {
    let accessKey = atom.config.get('live-code-runner.accessKey');
    if (accessKey) {
      accessKey = accessKey.trim();
    }
    return accessKey;
  },

  getSecretKey() {
    let secretKey = atom.config.get('live-code-runner.secretKey');
    if (secretKey) {
      secretKey = secretKey.trim();
    }
    return secretKey;
  },

  checkMandatorySettings() {
    let missingSettings = [];
    if (!this.getAccessKey()) {
      missingSettings.push("Access Key");
    }
    if (!this.getSecretKey()) {
      missingSettings.push("Secret Key");
    }
    if (missingSettings.length) {
      this.notifyMissingMandatorySettings(missingSettings);
    }
    this.BackendAISDK.accessKey = this.getAccessKey();
    this.BackendAISDK.secretKey = this.getSecretKey();
    return missingSettings.length === 0;
  },

  notifyMissingMandatorySettings(missingSettings) {
    let notification;
    let context = this;
    let errorMsg = `live-code-runner: Please input following settings: ${missingSettings.join(', ')}`;

    notification = atom.notifications.addInfo(errorMsg, {
      dismissable: true,
      buttons: [{
        text: "Package settings",
        onDidClick() {
          context.goToPackageSettings();
          return notification.dismiss();
        }
      }]
    });
    return true;
  },

  goToPackageSettings() {
    return atom.workspace.open("atom://config/packages/live-code-runner");
  },

  runcode() {
    this.BackendAISDK.accessKey = this.getAccessKey();
    this.BackendAISDK.secretKey = this.getSecretKey();
    this.AtomLiveCodeRunnerView.clearConsoleMessage();
    return this.sendCode();
  },

  getAPIversion() {
    return this.BackendAISDK.getAPIversion();
  },

  createKernel(kernelType) {
    this.continuation = false;
    this.waiting_input = false;
    let parentObj = this;
    let msg = "Preparing kernel...";
    this.AtomLiveCodeRunnerView.addConsoleMessage(msg);
    return this.BackendAISDK.createKernel(kernelType)
      .then( function(response) {
        let notification;
        if (response.ok === false) {
          let errorMsg = `live-code-runner: ${response.statusText}`;
          notification = atom.notifications.addError(errorMsg, {dismissable: true});
          return false;
        } else if (response.status === 201) {
          return response.json().then( function(json) {
            console.debug(`Kernel ID: ${json.kernelId}`);
            parentObj.kernelId = json.kernelId;
            msg = "Kernel prepared.";
            parentObj.AtomLiveCodeRunnerView.addConsoleMessage(msg);
            //notification = atom.notifications.addSuccess(msg);
            //setTimeout(() => notification.dismiss(), 1000);
            parentObj.AtomLiveCodeRunnerView.setKernelIndicator(kernelType);
            return true;
          });
        }
      }, function(e) {}
      );
  },

  destroyKernel(kernelId) {
    this.continuation = false;
    this.waiting_input = false;
    let msg = "Destroying kernel...";
    this.AtomLiveCodeRunnerView.addConsoleMessage(msg);
    return this.BackendAISDK.destroyKernel(kernelId)
      .then( function(response) {
        if (response.ok === false) {
          if (response.status !== 404) {
            let errorMsg = `live-code-runner: kernel destroy failed - ${response.statusText}`;
            let notification = atom.notifications.addError(errorMsg,
              {dismissable: true});
            return false;
          } else {
            return true;
          }
        }
        return true;
      }, e => false);
  },

  refreshKernel() {
    this.continuation = false;
    this.waiting_input = false;
    let msg = "Refreshing kernel...";
    this.AtomLiveCodeRunnerView.addConsoleMessage(msg);
    return this.BackendAISDK.refreshKernel(this.kernelId)
      .then( function(response) {
        let notification;
        if (response.ok === false) {
          let errorMsg = `live-code-runner: ${response.statusText}`;
          notification = atom.notifications.addError(errorMsg,
            {dismissable: true});
        } else {
          if (response.status !== 404) {
            msg = "live-code-runner: kernel refreshed";
            notification = atom.notifications.addSuccess(msg);
          }
        }
        return true;
      }, e => false);
  },

  chooseKernelType() {
    let grammar;
    let editor = atom.workspace.getActiveTextEditor();
    if (editor) {
      grammar = editor.getGrammar();
    } else {
      grammar = null;
    }
    if (grammar) {
      let kernelName;
      let grammarName = (grammar.name || grammar.scopeName).toLowerCase();
      switch (grammarName) {
        case "python":
          let code = editor.getText();
          if (code.search("tensorflow") > 0) {
            kernelName = "tensorflow-python3-gpu";
          } else if (code.search("keras") > 0) {
              kernelName = "tensorflow-python3-gpu";
          } else if (code.search("theano") > 0) {
              kernelName = "python3-theano";
          } else if (code.search("caffe") > 0) {
              kernelName = "python3-caffe";
          } else {
            kernelName = "python3";
          }
          break;
        case "r": kernelName = "r3"; break;
        case "julia": kernelName = "julia"; break;
        case "lua": kernelName = "lua5"; break;
        case "php": kernelName = "php7"; break;
        case "haskell": kernelName = "haskell"; break;
        case "matlab": case "octave": kernelName = "octave4"; break;
        case "nodejs": case "javascript": kernelName = "nodejs4"; break;
        default: kernelName = null;
      }
      console.log(`Kernel Language: ${kernelName}`);
      return kernelName;
    }
  },

  sendCode() {
    let errorMsg, notification;
    let kernelType = this.chooseKernelType();
    if (kernelType === null) {
      errorMsg = "live-code-runner: language is not specified by Atom.";
      notification = atom.notifications.addError(errorMsg, { dismissable: true,
      description: 'Check the grammar indicator at bottom bar and make sure that it is correctly recoginzed (NOT `Plain Text`).\nTry one of the followings:\n * Save current editor with proper file extension.\n * Install extra lauguage support package. (e.g. `language-r`, `language-haskell`)'
    }
      );
      return false;
    }
    if ((kernelType !== this.kernelType) || (this.kernelId === null)) {
      if (this.kernelId !== null) {
        let destroyAndCreateAndRun = this.destroyKernel(this.kernelId)
        .then( result => {
          if (result === true) {
            return this.createKernel(kernelType);
          } else {
            return false;
          }
        }
        )
        .then( result => {
          if (result === true) {
            this.kernelType = kernelType;
            this.runId = this.generateRunId();
            return this.sendCode();
          }
        }
        );
        return true;
      } else {
        let createAndRun = this.createKernel(kernelType).then( result => {
          if (result === true) {
            this.kernelType = kernelType;
            this.runId = this.generateRunId();
            return this.sendCode();
          }
        }
        );
        return true;
      }
    }
    this.resultPanel.show();
    let msg = "Running...";
    let mode = "query";
    if (this.waiting_input === true) {
      console.debug("Sending input...");
      mode = "input";
      this.waiting_input = false;
    } else if (this.continuation === true) {
      this.code = '';
      mode = "continue";
    } else {
      this.AtomLiveCodeRunnerView.clearContent();
      this.AtomLiveCodeRunnerView.addConsoleMessage(msg);
      let editor = atom.workspace.getActiveTextEditor();
      this.code = editor.getText();
      this._exec_starts = new Date().getTime();
    }
    return this.BackendAISDK.runCode(this.code, this.kernelId, this.runId, mode)
      .then( response => {
        if (response.ok === false) {
          errorMsg = `live-code-runner: ${response.statusText}`;
          notification = atom.notifications.addError(errorMsg, {dismissable: false});
          if (response.status === 404) {
            this.createKernel(this.kernelType);
          }
          this.continuation = false;
        } else {
          response.json().then( json => {
            let buffer = '';
            if (json.result.status) {
              if (json.result.status == "continued") {
                this.continuation = true;
                setTimeout(() => this.sendCode(), 1);
              } else if (json.result.status == "waiting-input") {
                this.continuation = true;
                this.waiting_input = true;
              } else {
                msg = "live-code-runner: Finished.";
                notification = atom.notifications.addSuccess(msg, {dismissable: false});
                setTimeout(() => notification.dismiss(), 1000);
                msg = "Finished.";
                this.AtomLiveCodeRunnerView.addConsoleMessage(msg);
                this.continuation = false;
                this.waiting_input = false;
              }
            }
            if (json.result.console) {
              for (let c of Array.from(json.result.console)) {
                if (c[0] == 'stdout') {
                  buffer = buffer + '<pre>'+this.escapeHtml(c[1])+'</pre>';
                }
                if (c[0] == 'stderr') {
                  buffer = buffer + '<pre class="live-code-runner-error-message">'+this.escapeHtml(c[1])+'</pre>';
                }
                if (c[0] == 'media') {
                  if (c[1][0] === "image/svg+xml") {
                    buffer = buffer + c[1][1];
                  }
                }
              }
            }
            this.AtomLiveCodeRunnerView.clearErrorMessage();
            if (json.result.exceptions && (json.result.exceptions.length > 0)) {
              let errBuffer = '';
              for (let exception of Array.from(json.result.exceptions)) {
                errBuffer = errBuffer + exception[0] + '(' + exception[1].join(', ') + ')';
              }
              this.AtomLiveCodeRunnerView.setErrorMessage(errBuffer);
            }
            this.AtomLiveCodeRunnerView.appendContent(buffer);
            if (this.waiting_input === true) {
              this.AtomLiveCodeRunnerView.addInputWidget();
            }
            return true;
          });
        }
        return true;
      }
      );
  },
  escapeHtml(text) {
    return text.replace(/[\"&<>]/g, function (a) {
      return { '"': '&quot;', '&': '&amp;', '<': '&lt;', '>': '&gt;' }[a];
    });
  },
  generateRunId() {
    var text = "";
    var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (var i = 0; i < 8; i++)
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    return text;
  }
};
