class Wl < Formula
  desc "Worklog - track work progress during development sessions"
  homepage "https://github.com/dohzya/tools"
  version "0.20.1"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.20.1/wl-darwin-arm64"
      sha256 "d60e3a19bf40e00005453f0d547204a7c935ccfd449a4c764f510246b61af777"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.20.1/wl-darwin-x86_64"
      sha256 "b13fbac4519a87e130743ee0e36a211009d2d3d5406b5e50b2669d90a90bde68"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.20.1/wl-linux-arm64"
      sha256 "3ea6be8b140bfcce273f457f77a65bbffc9b826056d910371ec99f3f8e453eef"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.20.1/wl-linux-x86_64"
      sha256 "334c4b3c9db687dacb1e546446622279f11f92a72a705ea5788989dc13d73b72"
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
