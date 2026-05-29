class Wl < Formula
  desc "Worklog - track work progress during development sessions"
  homepage "https://github.com/dohzya/tools"
  version "0.17.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.17.0/wl-darwin-arm64"
      sha256 "cad6e4462cc4bc232881640411c0830542b5232d8d501ab65310732f3f0c902a"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.17.0/wl-darwin-x86_64"
      sha256 "b5445ac10272c4e7995abc1ef146a5327ea3bf1baf849449fadb7aa412522fe7"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.17.0/wl-linux-arm64"
      sha256 "5e40ffaab0408a636b964f595413847ee6f73d111972b36c725517b765a7129a"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.17.0/wl-linux-x86_64"
      sha256 "9f1f5eee1b777b8937a086ae466c3c8ff51b9c3baadcd31f6196834a1e7fdee8"
    end
  end

  def install
    # Determine which binary was downloaded based on platform
    binary_name = if OS.mac?
      if Hardware::CPU.arm?
        "wl-darwin-arm64"
      else
        "wl-darwin-x86_64"
      end
    else
      if Hardware::CPU.arm?
        "wl-linux-arm64"
      else
        "wl-linux-x86_64"
      end
    end

    bin.install binary_name => "wl"
  end

  test do
    system "#{bin}/wl", "--help"
  end
end
