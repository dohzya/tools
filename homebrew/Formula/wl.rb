class Wl < Formula
  desc "Worklog - track work progress during development sessions"
  homepage "https://github.com/dohzya/tools"
  version "0.4.1"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.4.1/wl-darwin-arm64"
      sha256 "5d0d34203070888f6623d9860a8cb47b6221040a5be824ddb925de8a896c8b46"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.4.1/wl-darwin-x86_64"
      sha256 "e3db3d30d3ffa9a1ef45e4b95de6d3107fc993a485f364576b9af6b1d9d0d804"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.4.1/wl-linux-arm64"
      sha256 "cc335409de864c057ee5e1950826fe1326ea22a893f24d33989733ed2c1167d3"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.4.1/wl-linux-x86_64"
      sha256 "8a02356b12534c66a9cda6484682661a365ce37cb1a4549e2711199044162e18"
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
