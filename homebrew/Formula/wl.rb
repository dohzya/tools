class Wl < Formula
  desc "Worklog - track work progress during development sessions"
  homepage "https://github.com/dohzya/tools"
  version "0.10.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.10.0/wl-darwin-arm64"
      sha256 "faba765a0e29423c48d3685370ce12e7cfc11cfee29c2825a1b3a06d94472a24"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.10.0/wl-darwin-x86_64"
      sha256 "20d97b0e92ab72c303726e9788f3ec524fd3886165dec33fcd36875cafee4124"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.10.0/wl-linux-arm64"
      sha256 "512593b8f83bbb159cf12b4cdb3f0f913c26841fd92a24bb01683a200d41cbae"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.10.0/wl-linux-x86_64"
      sha256 "61295f90f1f8ed8efe2219248ff0e4b3504fc69235c9311d5624aa85e665d730"
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
