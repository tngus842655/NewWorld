package com.expeditionmonsters.app;

import android.os.Bundle;
import android.webkit.WebSettings;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // 시스템 글꼴 크기 무시 (검토 후속, 2026-08-30) — 웹뷰는 기기 fontScale을 textZoom으로
        // 반영해(예: 1.7배) 게임 레이아웃이 깨진다. 게임 UI는 자체 크기 체계를 쓰므로 100 고정.
        WebSettings settings = this.bridge.getWebView().getSettings();
        settings.setTextZoom(100);
    }
}
