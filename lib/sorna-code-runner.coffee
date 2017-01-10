SornaCodeRunnerView = require './sorna-code-runner-view'
{CompositeDisposable} = require 'atom'
crypto = require 'crypto'
util = require 'util'

module.exports = SornaCodeRunner =
  config: require('./config.coffee')
  SornaCodeRunnerView: null
  modalPanel: null
  subscriptions: null
  code: null
  accessKey: null
  secretKey: null
  signKey: null
  hash_type: 'sha256'

  baseURL: 'https://api.sorna.io'

  activate: (state) ->
    @SornaCodeRunnerView = new SornaCodeRunnerView(state.SornaCodeRunnerViewState)
    @modalPanel = atom.workspace.addModalPanel(item: @SornaCodeRunnerView.getElement(), visible: false)
    console.log('Current access key: '+ @getAccessKey())

    # Events subscribed to in atom's system can be easily cleaned up with a CompositeDisposable
    @subscriptions = new CompositeDisposable
    @checkMandatorySettings()

    # Register command
    @subscriptions.add atom.commands.add 'atom-text-editor',
      'sorna-code-runner:run': => @runcode()

  deactivate: ->
    @modalPanel.destroy()
    @subscriptions.dispose()

  serialize: ->
    SornaCodeRunnerViewState: @SornaCodeRunnerView.serialize()

  getAccessKey: ->
    accessKey = atom.config.get 'sorna-code-runner.accessKey'
    console.log accessKey
    if accessKey
      accessKey = accessKey.trim()
    return accessKey

  getSecretKey: ->
    secretKey = atom.config.get 'sorna-code-runner.secretKey'
    console.log secretKey
    if secretKey
      secretKey = secretKey.trim()
    return secretKey

  checkMandatorySettings: ->
    missingSettings = []
    if not @getAccessKey()
      missingSettings.push("Access Key")
    if not @getSecretKey()
      missingSettings.push("Secret Key")
    if missingSettings.length
      @notifyMissingMandatorySettings(missingSettings)
    return missingSettings.length is 0

  notifyMissingMandatorySettings: (missingSettings) ->
    context = this
    errorMsg = "sorna-code-runner: Mandatory settings missing: " + missingSettings.join(', ')

    notification = atom.notifications.addError errorMsg,
      dismissable: true
      buttons: [{
        text: "Package settings"
        onDidClick: ->
          context.goToPackageSettings()
          notification.dismiss()
      }]

  goToPackageSettings: ->
    atom.workspace.open("atom://config/packages/sorna-code-runner")

  runcode: ->
    console.log 'Code runner test!'

    if @modalPanel.isVisible()
      @modalPanel.hide()
    else
      editor = atom.workspace.getActiveTextEditor()
      content = editor.getText()
      @SornaCodeRunnerView.setContent(content)
      @modalPanel.show()
    @sendCode()

  # TODO
  getAPIversion: ->
    t = @getCurrentISO8601Date()
    k = @getSignKey(@getSecretKey(), t)
    requestHeaders = new Headers({
      "Content-Type": "application/json",
      "X-Sorna-Date": t
    })

    requestInfo =
      method: 'GET',
      headers: requestHeaders,
      mode: 'cors',
      cache: 'default'

    fetch(@baseURL+'/v1', requestInfo)
      .then( (response) ->
        console.log(response)
      )

    return "v1"

  # TODO
  createKernel: (kernelType) ->
    return true

  # TODO
  destroyKernel: ->
    return true

  # TODO
  sendCode: ->
    editor = atom.workspace.getActiveTextEditor()
    @code = editor.getText()
    t = @getCurrentISO8601Date()
    @signKey = @getSignKey(@getSecretKey(), t)
    requestHeaders = new Headers({
      "Content-Type": "application/json",
      "Content-Length": @code.length.toString(),
      "X-Sorna-Date": t})

    requestInfo =
      method: 'POST',
      headers: requestHeaders,
      mode: 'cors',
      cache: 'default'

    fetch(@baseURL, requestInfo)
      .then( (response) ->
        console.log(response)
      )

  getCurrentISO8601Date: ->
    now = new Date()
    year = ('0000' + now.getUTCFullYear()).slice(-4)
    month = ('0' + (now.getUTCMonth() + 1)).slice(-2)
    day = ('0' + (now.getUTCDate())).slice(-2)
    t = year + month + day
    return t

  sign: (key, key_encoding, msg, digest_type) ->
    kbuf = new Buffer(key, key_encoding)
    hmac = crypto.createHmac(@hash_type, kbuf)
    hmac.update(msg, 'utf8')
    return hmac.digest(digest_type)

  getSignKey: (secret_key, current_date)->
    console.log(secret_key)
    k1 = @sign(secret_key, 'utf8', current_date, 'binary')
    k2 = @sign(k1, 'binary', 'api.sorna.io', 'hex')
    console.log(k2)
    return k2
