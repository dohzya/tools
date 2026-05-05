class Wl < Formula
  desc "Worklog - track work progress during development sessions"
  homepage "https://github.com/dohzya/tools"
  version "0.14.1"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.14.1/wl-darwin-arm64"
      sha256 "22b044edf657bf163f4e0052ea1e058f28a620832aa6a021cfc66ecf60124667"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.14.1/wl-darwin-x86_64"
      sha256 "d4cc33e18cf626c13b309a428190c96e0d477bbfc2feaed2180c429101804dc0"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.14.1/wl-linux-arm64"
      sha256 "7c07adf252d1a7fd65a542b68a1e52a0702b66779a1e54d61865de9e43a78217"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.14.1/wl-linux-x86_64"
      sha256 "9ba02f80751a63fd3c9834659dd2c13ec4af36262e76b2ee5fe9b82ab57d2f44"
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
