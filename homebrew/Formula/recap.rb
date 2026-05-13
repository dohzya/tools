class Recap < Formula
  desc "Configurable project status dashboard for AI assistants"
  homepage "https://github.com/dohzya/tools"
  version "0.2.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/recap-v0.2.0/recap-darwin-arm64"
      sha256 "87bfad4143be13f441dcb2b6736d12122d20fea588eb24f983f48904af325f55"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/recap-v0.2.0/recap-darwin-x86_64"
      sha256 "8eed189656d5cf1eda9e28b790b4fafb610ef2317f594d804e183c83d3f75cab"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/recap-v0.2.0/recap-linux-arm64"
      sha256 "02795822752a2e5a5c23f57235935409fce43de72dd6c09a55172cd96014f982"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/recap-v0.2.0/recap-linux-x86_64"
      sha256 "c8f34248149ad24bdc0f693b8d2d1f7c1e98630b06a3004ac3a6596ffb2cd2ca"
    end
  end

  def install
    binary_name = if OS.mac?
      if Hardware::CPU.arm?
        "recap-darwin-arm64"
      else
        "recap-darwin-x86_64"
      end
    else
      if Hardware::CPU.arm?
        "recap-linux-arm64"
      else
        "recap-linux-x86_64"
      end
    end

    bin.install binary_name => "recap"
  end

  test do
    system "#{bin}/recap", "--help"
  end
end
