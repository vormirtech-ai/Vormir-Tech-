# The JavaScript bridge is reached by name from the web app, so it must survive
# any future shrinking pass.
-keepclassmembers class com.lavidhawa.pos.MainActivity$Bridge {
    public *;
}
-keepattributes JavascriptInterface
