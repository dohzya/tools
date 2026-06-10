class Wl < Formula
  desc "Worklog - track work progress during development sessions"
  homepage "https://github.com/dohzya/tools"
  version "0.18.1"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.18.1/wl-darwin-arm64"
      sha256 "6de04304d53f06f2de69299609aa156371bd5190c36c247f3f53eca4b7c874f1"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.18.1/wl-darwin-x86_64"
      sha256 "2fcde2730bae517dab90f8f116d8e0a8f145eebefe258b31cf1d280cebb4d515"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.18.1/wl-linux-arm64"
      sha256 "58d34aac182113d41ffd539f187a34db69d58033448f61729b21bd931e78c0e9"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.18.1/wl-linux-x86_64"
      sha256 "a08e9b6508f6cd1eece1028bca299d8d3f88600df29952d143df300827f54588"
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
