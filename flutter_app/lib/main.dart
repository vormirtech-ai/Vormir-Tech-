// Lavi The Dhawa & Family Restaurant — billing app.
//
// The billing system itself is the offline web app bundled at
// assets/www (copied from ../billing-app at build time). This Flutter shell
// hosts it and provides the three things the web layer cannot do by itself:
// printing a bill, saving a backup, and picking a backup to restore. Those go
// out over a method channel to this project's own Android code.
//
// Nothing here talks to a network. The app ships without the INTERNET
// permission, so every record stays on this one tablet.

import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: _navy,
    statusBarIconBrightness: Brightness.light,
  ));
  runApp(const LaviBillingApp());
}

const Color _navy = Color(0xFF1D2B45);
const Color _canvas = Color(0xFFF4F6FA);

class LaviBillingApp extends StatelessWidget {
  const LaviBillingApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Lavi Billing',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: _navy),
        scaffoldBackgroundColor: _canvas,
        useMaterial3: true,
      ),
      home: const BillingShell(),
    );
  }
}

class BillingShell extends StatefulWidget {
  const BillingShell({super.key});

  @override
  State<BillingShell> createState() => _BillingShellState();
}

class _BillingShellState extends State<BillingShell> {
  static const MethodChannel _native = MethodChannel('lavi.dhawa/native');

  /// Defines `window.LaviNative`, which is exactly the interface the web app
  /// looks for in `App.U.native()`. Everything is funnelled through the single
  /// `LaviBridge` channel this shell registers.
  static const String _bridgeShim = '''
(function () {
  if (window.LaviNative && window.LaviNative.__installed) return;
  function send(payload) {
    try { LaviBridge.postMessage(JSON.stringify(payload)); }
    catch (e) { /* the shell is gone; nothing useful to do here */ }
  }
  window.LaviNative = {
    __installed: true,
    platform: function () { return 'android'; },
    printHtml: function (title, html) {
      send({ op: 'print', title: String(title == null ? 'Bill' : title), html: String(html || '') });
    },
    saveFile: function (name, mime, content) {
      send({ op: 'save', name: String(name || 'export'), mime: String(mime || 'text/plain'), content: String(content == null ? '' : content) });
    },
    toastMessage: function (text) { send({ op: 'toast', text: String(text || '') }); }
  };
})();
''';

  late final WebViewController _controller;
  bool _loaded = false;
  DateTime? _lastBackPress;

  @override
  void initState() {
    super.initState();

    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(_canvas)
      ..enableZoom(false)
      ..addJavaScriptChannel('LaviBridge', onMessageReceived: _onBridgeMessage)
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageFinished: (String url) async {
            await _controller.runJavaScript(_bridgeShim);
            if (!mounted) return;
            setState(() => _loaded = true);
          },
          onNavigationRequest: (NavigationRequest request) {
            // Only the packaged app may load. There is nothing else to load:
            // the app has no network access at all.
            final bool isLocal = request.url.startsWith('file://') ||
                request.url.startsWith('about:');
            return isLocal
                ? NavigationDecision.navigate
                : NavigationDecision.prevent;
          },
        ),
      )
      ..loadFlutterAsset('assets/www/index.html');

    unawaited(_configureAndroid());
  }

  Future<void> _configureAndroid() async {
    final platform = _controller.platform;
    if (platform is! AndroidWebViewController) return;

    await platform.setMediaPlaybackRequiresUserGesture(false);

    // Restoring a backup opens a file input inside the web app; hand that to
    // Android's document picker.
    await platform.setOnShowFileSelector(_pickFileForWebView);
  }

  Future<List<String>> _pickFileForWebView(FileSelectorParams params) async {
    try {
      final String? uri = await _native.invokeMethod<String>('pickFile', <String, String>{
        'mime': params.acceptTypes.isNotEmpty && params.acceptTypes.first.isNotEmpty
            ? params.acceptTypes.first
            : '*/*',
      });
      if (uri == null || uri.isEmpty) return <String>[];
      return <String>[uri];
    } on PlatformException {
      return <String>[];
    }
  }

  /* ------------------------------------------------------------- bridge */

  void _onBridgeMessage(JavaScriptMessage message) {
    Map<String, dynamic> payload;
    try {
      final Object? decoded = jsonDecode(message.message);
      if (decoded is! Map<String, dynamic>) return;
      payload = decoded;
    } on FormatException {
      return;
    }

    final Object? op = payload['op'];

    if (op == 'print') {
      unawaited(_invoke('printHtml', <String, String>{
        'title': (payload['title'] as String?) ?? 'Bill',
        'html': (payload['html'] as String?) ?? '',
      }));
    } else if (op == 'save') {
      unawaited(_invoke('saveFile', <String, String>{
        'name': (payload['name'] as String?) ?? 'export',
        'mime': (payload['mime'] as String?) ?? 'text/plain',
        'content': (payload['content'] as String?) ?? '',
      }));
    } else if (op == 'toast') {
      _showMessage((payload['text'] as String?) ?? '');
    }
  }

  Future<void> _invoke(String method, Map<String, String> args) async {
    try {
      await _native.invokeMethod<void>(method, args);
    } on PlatformException catch (error) {
      _showMessage(error.message ?? 'That did not work on this tablet.');
    }
  }

  void _showMessage(String text) {
    if (!mounted || text.isEmpty) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(text), duration: const Duration(seconds: 2)),
    );
  }

  /* --------------------------------------------------------- navigation */

  Future<void> _handleBack(bool didPop) async {
    if (didPop) return;

    if (await _controller.canGoBack()) {
      await _controller.goBack();
      return;
    }

    final DateTime now = DateTime.now();
    final DateTime? previous = _lastBackPress;
    if (previous != null && now.difference(previous) < const Duration(seconds: 2)) {
      await SystemNavigator.pop();
      return;
    }

    _lastBackPress = now;
    _showMessage('Press back again to close the app');
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (bool didPop, Object? result) {
        unawaited(_handleBack(didPop));
      },
      child: Scaffold(
        backgroundColor: _canvas,
        body: SafeArea(
          child: Stack(
            children: <Widget>[
              WebViewWidget(controller: _controller),
              if (!_loaded) const _Splash(),
            ],
          ),
        ),
      ),
    );
  }
}

/// Shown for the moment between launch and the web app painting its first
/// screen, so the tablet never shows a blank white rectangle.
class _Splash extends StatelessWidget {
  const _Splash();

  @override
  Widget build(BuildContext context) {
    return Container(
      color: _canvas,
      alignment: Alignment.center,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Container(
            width: 74,
            height: 74,
            decoration: const BoxDecoration(color: _navy, shape: BoxShape.circle),
            alignment: Alignment.center,
            child: const Text(
              'DA',
              style: TextStyle(
                color: Color(0xFFF0F3F8),
                fontSize: 24,
                fontWeight: FontWeight.bold,
                letterSpacing: 1,
              ),
            ),
          ),
          const SizedBox(height: 18),
          const Text(
            'Lavi The Dhawa',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: _navy),
          ),
          const SizedBox(height: 4),
          const Text(
            '& Family Restaurant',
            style: TextStyle(fontSize: 13, color: Color(0xFFB0311F), fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 22),
          const SizedBox(
            width: 22,
            height: 22,
            child: CircularProgressIndicator(strokeWidth: 2.4, color: _navy),
          ),
        ],
      ),
    );
  }
}
